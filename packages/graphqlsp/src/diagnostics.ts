import ts from 'typescript/lib/tsserverlibrary';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
  print,
} from 'graphql';
import { LRUCache } from 'lru-cache';
import fnv1a from '@sindresorhus/fnv1a';

import {
  findAllCallExpressions,
  findAllImports,
  findAllTaggedTemplateNodes,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';

const clientDirectives = new Set([
  'populate',
  'client',
  '_optional',
  '_required',
  'arguments',
  'argumentDefinitions',
  'connection',
  'refetchable',
  'relay',
  'required',
  'inline',
]);
const directiveRegex = /Unknown directive "@([^)]+)"/g;

export const SEMANTIC_DIAGNOSTIC_CODE = 52001;
export const MISSING_OPERATION_NAME_CODE = 52002;
export const MISSING_FRAGMENT_CODE = 52003;
export const USING_DEPRECATED_FIELD_CODE = 52004;

let isGeneratingTypes = false;

const cache = new LRUCache<number, ts.Diagnostic[]>({
  // how long to live in ms
  ttl: 1000 * 60 * 15,
  max: 5000,
});

export function getGraphQLDiagnostics(
  filename: string,
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const tagTemplate = info.config.template || 'gql';
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode> = [],
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, tagTemplate, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source);
  }

  const texts = nodes.map(node => {
    if (
      (ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !isCallExpression
    ) {
      if (ts.isTaggedTemplateExpression(node.parent)) {
        node = node.parent;
      } else {
        return undefined;
      }
    }

    return resolveTemplate(node, filename, info).combinedText;
  });

  const cacheKey = fnv1a(
    isCallExpression
      ? texts.join('-') +
          fragments.map(x => print(x)).join('-') +
          schema.version
      : texts.join('-') + schema.version
  );

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  } else {
    const tsDiagnostics = runDiagnostics(
      source,
      { nodes, fragments },
      schema,
      info
    );
    cache.set(cacheKey, tsDiagnostics);
    return tsDiagnostics;
  }
}

const runDiagnostics = (
  source: ts.SourceFile,
  {
    nodes,
    fragments,
  }: {
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
    fragments: FragmentDefinitionNode[];
  },
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
) => {
  const tagTemplate = info.config.template || 'gql';
  const filename = source.fileName;
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  const diagnostics = nodes
    .map(originalNode => {
      let node = originalNode;
      if (
        !isCallExpression &&
        (ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node))
      ) {
        if (ts.isTaggedTemplateExpression(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }

      const { combinedText: text, resolvedSpans } = resolveTemplate(
        node,
        filename,
        info
      );
      const lines = text.split('\n');

      let isExpression = false;
      if (ts.isAsExpression(node.parent)) {
        if (ts.isExpressionStatement(node.parent.parent)) {
          isExpression = true;
        }
      } else if (ts.isExpressionStatement(node.parent)) {
        isExpression = true;
      }
      // When we are dealing with a plain gql statement we have to add two these can be recognised
      // by the fact that the parent is an expressionStatement
      let startingPosition =
        node.pos +
        (isCallExpression ? 0 : tagTemplate.length + (isExpression ? 2 : 1));
      const endPosition = startingPosition + node.getText().length;

      let docFragments = [...fragments];
      if (isCallExpression) {
        try {
          const documentFragments = parse(text, {
            noLocation: true,
          }).definitions.filter(x => x.kind === Kind.FRAGMENT_DEFINITION);
          docFragments = docFragments.filter(
            x =>
              !documentFragments.some(
                y =>
                  y.kind === Kind.FRAGMENT_DEFINITION &&
                  y.name.value === x.name.value
              )
          );
        } catch (e) {}
      }

      const graphQLDiagnostics = getDiagnostics(
        text,
        schema.current,
        undefined,
        undefined,
        docFragments
      )
        .filter(diag => {
          if (!diag.message.includes('Unknown directive')) return true;

          const [message] = diag.message.split('(');
          const matches = directiveRegex.exec(message);
          if (!matches) return true;
          const directiveNmae = matches[1];
          return !clientDirectives.has(directiveNmae);
        })
        .map(x => {
          const { start, end } = x.range;

          // We add the start.line to account for newline characters which are
          // split out
          let startChar = startingPosition + start.line;
          for (let i = 0; i <= start.line; i++) {
            if (i === start.line) startChar += start.character;
            else startChar += lines[i].length;
          }

          let endChar = startingPosition + end.line;
          for (let i = 0; i <= end.line; i++) {
            if (i === end.line) endChar += end.character;
            else endChar += lines[i].length;
          }

          const locatedInFragment = resolvedSpans.find(x => {
            const newEnd = x.new.start + x.new.length;
            return startChar >= x.new.start && endChar <= newEnd;
          });

          if (!!locatedInFragment) {
            return {
              ...x,
              start: locatedInFragment.original.start,
              length: locatedInFragment.original.length,
            };
          } else {
            if (startChar > endPosition) {
              // we have to calculate the added length and fix this
              const addedCharacters = resolvedSpans
                .filter(x => x.new.start + x.new.length < startChar)
                .reduce(
                  (acc, span) => acc + (span.new.length - span.original.length),
                  0
                );
              startChar = startChar - addedCharacters;
              endChar = endChar - addedCharacters;
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            } else {
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            }
          }
        })
        .filter(x => x.start + x.length <= endPosition);

      try {
        const parsed = parse(text, { noLocation: true });

        if (
          parsed.definitions.some(x => x.kind === Kind.OPERATION_DEFINITION)
        ) {
          const op = parsed.definitions.find(
            x => x.kind === Kind.OPERATION_DEFINITION
          ) as OperationDefinitionNode;
          if (!op.name) {
            graphQLDiagnostics.push({
              message: 'Operation needs a name for types to be generated.',
              start: node.pos,
              code: MISSING_OPERATION_NAME_CODE,
              length: originalNode.getText().length,
              range: {} as any,
              severity: 2,
            } as any);
          }
        }
      } catch (e) {}

      return graphQLDiagnostics;
    })
    .flat()
    .filter(Boolean) as Array<Diagnostic & { length: number; start: number }>;

  const tsDiagnostics = diagnostics.map(diag => ({
    file: source,
    length: diag.length,
    start: diag.start,
    category:
      diag.severity === 2
        ? ts.DiagnosticCategory.Warning
        : ts.DiagnosticCategory.Error,
    code:
      typeof diag.code === 'number'
        ? diag.code
        : diag.severity === 2
        ? USING_DEPRECATED_FIELD_CODE
        : SEMANTIC_DIAGNOSTIC_CODE,
    messageText: diag.message.split('\n')[0],
  }));

  const importDiagnostics = checkImportsForFragments(source, info);

  return [...tsDiagnostics, ...importDiagnostics];
};

const checkImportsForFragments = (
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
) => {
  const imports = findAllImports(source);

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? false;
  const tsDiagnostics: ts.Diagnostic[] = [];
  if (imports.length && shouldCheckForColocatedFragments) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    imports.forEach(imp => {
      if (!imp.importClause) return;

      const importedNames: string[] = [];
      if (imp.importClause.name) {
        importedNames.push(imp.importClause?.name.text);
      }

      if (
        imp.importClause.namedBindings &&
        ts.isNamespaceImport(imp.importClause.namedBindings)
      ) {
        // TODO: we might need to warn here when the fragment is unused as a namespace import
        return;
      } else if (
        imp.importClause.namedBindings &&
        ts.isNamedImportBindings(imp.importClause.namedBindings)
      ) {
        imp.importClause.namedBindings.elements.forEach(el => {
          importedNames.push(el.name.text);
        });
      }

      const symbol = typeChecker?.getSymbolAtLocation(imp.moduleSpecifier);
      if (!symbol) return;

      const moduleExports = typeChecker?.getExportsOfModule(symbol);
      if (!moduleExports) return;

      const missingImports = moduleExports
        .map(exp => {
          if (importedNames.includes(exp.name)) {
            return;
          }

          const declarations = exp.getDeclarations();
          const declaration = declarations?.find(x => {
            // TODO: check whether the sourceFile.fileName resembles the module
            // specifier
            return true;
          });

          if (!declaration) return;

          const [template] = findAllTaggedTemplateNodes(declaration);
          if (template) {
            let node = template;
            if (
              ts.isNoSubstitutionTemplateLiteral(node) ||
              ts.isTemplateExpression(node)
            ) {
              if (ts.isTaggedTemplateExpression(node.parent)) {
                node = node.parent;
              } else {
                return;
              }
            }

            const text = resolveTemplate(
              node,
              node.getSourceFile().fileName,
              info
            ).combinedText;
            try {
              const parsed = parse(text, { noLocation: true });
              if (
                parsed.definitions.every(
                  x => x.kind === Kind.FRAGMENT_DEFINITION
                )
              ) {
                return `'${exp.name}'`;
              }
            } catch (e) {
              return;
            }
          }
        })
        .filter(Boolean);

      if (missingImports.length) {
        tsDiagnostics.push({
          file: source,
          length: imp.getText().length,
          start: imp.getStart(),
          category: ts.DiagnosticCategory.Message,
          code: MISSING_FRAGMENT_CODE,
          messageText: `Missing Fragment import(s) ${missingImports.join(
            ', '
          )} from ${imp.moduleSpecifier.getText()}.`,
        });
      }
    });
  }

  return tsDiagnostics;
};
