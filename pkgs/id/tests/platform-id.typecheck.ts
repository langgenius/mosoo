import type { AccountId, AgentId, PlatformId } from "@mosoo/id";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;

type LowercasePlatformIdLiteral = "01j00000000000000000000001";

const platformIdTypeContract: [
  AssertTrue<IsAssignable<PlatformId, string>>,
  AssertFalse<IsAssignable<string, PlatformId>>,
  AssertFalse<IsAssignable<LowercasePlatformIdLiteral, PlatformId>>,
  AssertTrue<IsAssignable<AccountId, PlatformId>>,
  AssertFalse<IsAssignable<PlatformId, AccountId>>,
  AssertFalse<IsAssignable<AccountId, AgentId>>,
  AssertFalse<IsAssignable<AgentId, AccountId>>,
] = [true, false, false, true, false, false, false];

const plainString = "01J00000000000000000000001" as string;
const accountId = "01J00000000000000000000001" as AccountId;
const agentId = "01J00000000000000000000002" as AgentId;

// @ts-expect-error plain strings must enter through create/parse/normalize/assert/is.
const plainStringCannotBePlatformId: PlatformId = plainString;

// @ts-expect-error lowercase literals must be normalized before they become PlatformId.
const lowercaseLiteralCannotBePlatformId: PlatformId = "01j00000000000000000000001";

// @ts-expect-error semantic platform IDs with different names must stay isolated.
const accountIdCannotBeAgentId: AgentId = accountId;

// @ts-expect-error semantic platform IDs with different names must stay isolated.
const agentIdCannotBeAccountId: AccountId = agentId;

const accountIdCanBePlatformId: PlatformId = accountId;
const agentIdCanBePlatformId: PlatformId = agentId;

void platformIdTypeContract;
void plainStringCannotBePlatformId;
void lowercaseLiteralCannotBePlatformId;
void accountIdCannotBeAgentId;
void agentIdCannotBeAccountId;
void accountIdCanBePlatformId;
void agentIdCanBePlatformId;
