/* eslint-disable */
import * as types from './graphql';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
  '\n  fragment pokemonFields on Pokemon {\n    id\n    name\n    attacks {\n      fast {\n        damage\n        name\n      }\n    }\n  }\n':
    types.PokemonFieldsFragmentDoc,
  '\n  fragment weaknessFields on Pokemon {\n    weaknesses\n  }\n':
    types.WeaknessFieldsFragmentDoc,
  '\n  query Pok($limit: Int!) {\n    pokemons(limit: $limit) {\n      id\n      name\n      fleeRate\n      classification\n      ...pokemonFields\n      ...weaknessFields\n      __typename\n    }\n  }\n':
    types.PokDocument,
  '\n  query Po($id: ID!) {\n    pokemon(id: $id) {\n      id\n      fleeRate\n      __typename\n    }\n  }\n':
    types.PoDocument,
  '\n  query PokemonsAreAwesome {\n    pokemons {\n      id\n    }\n  }\n':
    types.PokemonsAreAwesomeDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment pokemonFields on Pokemon {\n    id\n    name\n    attacks {\n      fast {\n        damage\n        name\n      }\n    }\n  }\n'
): (typeof documents)['\n  fragment pokemonFields on Pokemon {\n    id\n    name\n    attacks {\n      fast {\n        damage\n        name\n      }\n    }\n  }\n'];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  fragment weaknessFields on Pokemon {\n    weaknesses\n  }\n'
): (typeof documents)['\n  fragment weaknessFields on Pokemon {\n    weaknesses\n  }\n'];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Pok($limit: Int!) {\n    pokemons(limit: $limit) {\n      id\n      name\n      fleeRate\n      classification\n      ...pokemonFields\n      ...weaknessFields\n      __typename\n    }\n  }\n'
): (typeof documents)['\n  query Pok($limit: Int!) {\n    pokemons(limit: $limit) {\n      id\n      name\n      fleeRate\n      classification\n      ...pokemonFields\n      ...weaknessFields\n      __typename\n    }\n  }\n'];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query Po($id: ID!) {\n    pokemon(id: $id) {\n      id\n      fleeRate\n      __typename\n    }\n  }\n'
): (typeof documents)['\n  query Po($id: ID!) {\n    pokemon(id: $id) {\n      id\n      fleeRate\n      __typename\n    }\n  }\n'];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: '\n  query PokemonsAreAwesome {\n    pokemons {\n      id\n    }\n  }\n'
): (typeof documents)['\n  query PokemonsAreAwesome {\n    pokemons {\n      id\n    }\n  }\n'];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never;
