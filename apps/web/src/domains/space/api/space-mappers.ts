import type {
  FileEntry,
  SpaceFileListing,
  SpaceFileLockHolder,
  SpaceFileLockView,
  SpaceView,
} from "@mosoo/contracts/space";

import { toAccountId, toAgentId, toFileId, toSpaceId } from "@/routes/typed-id";

type GraphQLSpaceView = Omit<SpaceView, "id" | "ownerId"> & {
  id: string;
  ownerId: string;
};

type GraphQLSpaceFileLockHolder = Omit<SpaceFileLockHolder, "id"> & {
  id: string;
};

type GraphQLSpaceFileLockView = Omit<SpaceFileLockView, "holder"> & {
  holder: GraphQLSpaceFileLockHolder;
};

type GraphQLFileEntry = Omit<FileEntry, "id" | "lock"> & {
  id: string;
  lock: GraphQLSpaceFileLockView | null;
};

type GraphQLSpaceFileListing = Omit<SpaceFileListing, "files"> & {
  files: GraphQLFileEntry[];
};

function toSpaceFileLockHolder(holder: GraphQLSpaceFileLockHolder): SpaceFileLockHolder {
  return {
    ...holder,
    id: holder.type === "agent" ? toAgentId(holder.id) : toAccountId(holder.id),
  };
}

function toSpaceFileLock(lock: GraphQLSpaceFileLockView): SpaceFileLockView {
  return {
    ...lock,
    holder: toSpaceFileLockHolder(lock.holder),
  };
}

function toFileEntry(file: GraphQLFileEntry): FileEntry {
  return {
    ...file,
    id: toFileId(file.id),
    lock: file.lock === null ? null : toSpaceFileLock(file.lock),
  };
}

export function toSpaceView(space: GraphQLSpaceView): SpaceView {
  return {
    ...space,
    id: toSpaceId(space.id),
    ownerId: toAccountId(space.ownerId),
  };
}

export function toSpaceFileListing(listing: GraphQLSpaceFileListing): SpaceFileListing {
  return {
    ...listing,
    files: listing.files.map(toFileEntry),
  };
}
