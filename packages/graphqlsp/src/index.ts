import ts from 'typescript/lib/tsserverlibrary';

import { SchemaOrigin, loadSchema } from './graphql/getSchema';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLQuickInfo } from './quickInfo';
import { getGraphQLDiagnostics } from './diagnostics';

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<
    keyof ts.LanguageService
  >) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
}

export type Logger = (msg: string) => void;

type Config = {
  schema: SchemaOrigin | string;
  template?: string;
  templateIsCallExpression?: boolean;
  disableTypegen?: boolean;
  extraTypes?: string;
  scalars?: Record<string, unknown>;
  shouldCheckForColocatedFragments?: boolean;
};

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const config: Config = info.config;

  logger('config: ' + JSON.stringify(config));
  if (!config.schema) {
    logger('Missing "schema" option in configuration.');
    throw new Error('Please provide a GraphQL Schema!');
  }

  logger('Setting up the GraphQL Plugin');

  const scalars = config.scalars || {};
  const extraTypes = config.extraTypes || '';
  const disableTypegen = config.disableTypegen ?? false;

  const proxy = createBasicDecorator(info);

  const baseTypesPath =
    info.project.getCurrentDirectory() + '/__generated__/baseGraphQLSP.ts';

  const schema = loadSchema(
    info.project.getProjectName(),
    config.schema,
    logger,
    baseTypesPath,
    !disableTypegen,
    scalars,
    extraTypes
  );

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);

    const graphQLDiagnostics = getGraphQLDiagnostics(
      originalDiagnostics.length > 0,
      filename,
      baseTypesPath,
      schema,
      info
    );

    return graphQLDiagnostics
      ? [...graphQLDiagnostics, ...originalDiagnostics]
      : originalDiagnostics;
  };

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
    options: any
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const completions = getGraphQLCompletions(
      filename,
      cursorPosition,
      schema,
      info
    );

    if (completions && completions.entries.length) {
      return completions;
    } else {
      return (
        info.languageService.getCompletionsAtPosition(
          filename,
          cursorPosition,
          options
        ) || {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: [],
        }
      );
    }
  };

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const quickInfo = getGraphQLQuickInfo(
      filename,
      cursorPosition,
      schema,
      info
    );

    if (quickInfo) return quickInfo;

    return info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    );
  };

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export default init;
