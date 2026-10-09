import { parsePlatformId } from "./index";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  EnvironmentId,
  EnvironmentRevisionId,
  OrganizationId,
  ProjectId,
  RuntimeEventId,
  SandboxId,
  SessionId,
  SessionRunId,
  SkillId,
  VendorCredentialId,
} from "./index";

export const PLATFORM_ID_FIXTURES = {
  account: parsePlatformId<AccountId>("01J00000000000000000000001"),
  agent: parsePlatformId<AgentId>("01J00000000000000000000002"),
  agentDeploymentVersion: parsePlatformId<AgentDeploymentVersionId>("01J00000000000000000000006"),
  driverInstance: parsePlatformId<DriverInstanceId>("01J00000000000000000000008"),
  environment: parsePlatformId<EnvironmentId>("01J0000000000000000000000A"),
  environmentRevision: parsePlatformId<EnvironmentRevisionId>("01J0000000000000000000000B"),
  organization: parsePlatformId<OrganizationId>("01J0000000000000000000000D"),
  project: parsePlatformId<ProjectId>("01J0000000000000000000000E"),
  runtimeEvent: parsePlatformId<RuntimeEventId>("01J0000000000000000000000G"),
  sandbox: parsePlatformId<SandboxId>("01J0000000000000000000000J"),
  session: parsePlatformId<SessionId>("01J0000000000000000000000K"),
  sessionRun: parsePlatformId<SessionRunId>("01J0000000000000000000000N"),
  skill: parsePlatformId<SkillId>("01J0000000000000000000000P"),
  vendorCredential: parsePlatformId<VendorCredentialId>("01J0000000000000000000000R"),
} as const;
