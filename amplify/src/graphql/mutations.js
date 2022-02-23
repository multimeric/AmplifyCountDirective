/* eslint-disable */
// this is an auto generated file. This will be overwritten

export const createFoo = /* GraphQL */ `
  mutation CreateFoo(
    $input: CreateFooInput!
    $condition: ModelFooConditionInput
  ) {
    createFoo(input: $input, condition: $condition) {
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
export const updateFoo = /* GraphQL */ `
  mutation UpdateFoo(
    $input: UpdateFooInput!
    $condition: ModelFooConditionInput
  ) {
    updateFoo(input: $input, condition: $condition) {
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
export const deleteFoo = /* GraphQL */ `
  mutation DeleteFoo(
    $input: DeleteFooInput!
    $condition: ModelFooConditionInput
  ) {
    deleteFoo(input: $input, condition: $condition) {
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
