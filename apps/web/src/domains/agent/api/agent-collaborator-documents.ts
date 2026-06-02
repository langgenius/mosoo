import { graphql } from "@/gql";

export const ADD_AGENT_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation AddAgentCollaborator($input: AddAgentCollaboratorInput!) {
    addAgentCollaborator(input: $input) {
      ok
    }
  }
`);

export const REMOVE_AGENT_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation RemoveAgentCollaborator($input: RemoveAgentCollaboratorInput!) {
    removeAgentCollaborator(input: $input) {
      ok
    }
  }
`);

export const UPDATE_AGENT_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateAgentCollaborator($input: UpdateAgentCollaboratorInput!) {
    updateAgentCollaborator(input: $input) {
      ok
    }
  }
`);
