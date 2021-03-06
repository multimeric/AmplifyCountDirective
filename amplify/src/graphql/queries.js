/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const getFoo = /* GraphQL */ `
  query GetFoo($id: ID!) {
    getFoo(id: $id) {
      id
      string_field
      int_field
      float_field
      bool_field
      createdAt
      updatedAt
    }
  }
`;
export const listFoos = /* GraphQL */ `
  query ListFoos(
    $filter: ModelFooFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listFoos(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        string_field
        int_field
        float_field
        bool_field
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;
export const getBar = /* GraphQL */ `
  query GetBar($id: ID!) {
    getBar(id: $id) {
      id
      string_field
      int_field
      float_field
      bool_field
      createdAt
      updatedAt
    }
  }
`;
export const listBars = /* GraphQL */ `
  query ListBars(
    $filter: ModelBarFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listBars(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        string_field
        int_field
        float_field
        bool_field
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;
export const countFoo = /* GraphQL */ `
  query CountFoo($filter: ModelFooFilterInput) {
    countFoo(filter: $filter)
  }
`;
export const countBar = /* GraphQL */ `
  query CountBar($filter: ModelBarFilterInput) {
    countBar(filter: $filter)
  }
`;
