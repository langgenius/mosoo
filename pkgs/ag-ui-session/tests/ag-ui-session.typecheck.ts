import type { AGUIEvent } from "@ag-ui/core";
import type {
  AgUiSessionEvent,
  SessionLiveState,
  SessionLiveStateSchema,
} from "@mosoo/ag-ui-session";

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;

type IsMutuallyAssignable<Left, Right> =
  IsAssignable<Left, Right> extends true ? IsAssignable<Right, Left> : false;

type AssertTrue<T extends true> = T;

const agUiSessionTypeContract: [
  AssertTrue<IsMutuallyAssignable<typeof SessionLiveStateSchema.infer, SessionLiveState>>,
  AssertTrue<IsAssignable<AgUiSessionEvent, AGUIEvent>>,
] = [true, true];

void agUiSessionTypeContract;
