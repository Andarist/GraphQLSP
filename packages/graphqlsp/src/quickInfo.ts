import ts from 'typescript/lib/tsserverlibrary';
import { getHoverInformation } from 'graphql-language-service';
import { GraphQLSchema } from 'graphql';

import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findNode,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { Cursor } from './ast/cursor';
import { Logger } from '.';

export function getGraphQLQuickInfo(
  filename: string,
  cursorPosition: number,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.QuickInfo | undefined {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const tagTemplate = info.config.template || 'gql';
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  if (
    ts.isCallExpression(node) &&
    isCallExpression &&
    node.expression.getText() === tagTemplate &&
    node.arguments.length > 0 &&
    ts.isNoSubstitutionTemplateLiteral(node.arguments[0])
  ) {
    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schema.current || !foundToken) return undefined;

    const queryText = node.arguments[0].getText();
    const cursor = new Cursor(foundToken.line, foundToken.start);
    const hoverInfo = getHoverInformation(schema.current, queryText, cursor);

    return {
      kind: ts.ScriptElementKind.string,
      textSpan: {
        start: cursorPosition,
        length: 1,
      },
      kindModifiers: 'text',
      documentation: Array.isArray(hoverInfo)
        ? hoverInfo.map(item => ({ kind: 'text', text: item as string }))
        : [{ kind: 'text', text: hoverInfo as string }],
    };
  } else if (ts.isTaggedTemplateExpression(node)) {
    const { template, tag } = node;
    if (!ts.isIdentifier(tag) || tag.text !== tagTemplate) return undefined;

    const foundToken = getToken(template, cursorPosition);

    if (!foundToken || !schema.current) return undefined;

    const { combinedText: text, resolvedSpans } = resolveTemplate(
      node,
      filename,
      info
    );

    const amountOfLines = resolvedSpans
      .filter(
        x =>
          x.original.start < cursorPosition &&
          x.original.start + x.original.length < cursorPosition
      )
      .reduce((acc, span) => acc + (span.lines - 1), 0);

    foundToken.line = foundToken.line + amountOfLines;

    const hoverInfo = getHoverInformation(
      schema.current,
      text,
      new Cursor(foundToken.line, foundToken.start)
    );

    return {
      kind: ts.ScriptElementKind.label,
      textSpan: {
        start: cursorPosition,
        length: 1,
      },
      kindModifiers: 'text',
      documentation: Array.isArray(hoverInfo)
        ? hoverInfo.map(item => ({ kind: 'text', text: item as string }))
        : [{ kind: 'text', text: hoverInfo as string }],
    } as ts.QuickInfo;
  } else {
    return undefined;
  }
}
