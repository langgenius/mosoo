import { runUploadSession } from "@/domains/file/api/file-upload-client";
import { addSessionResourceUpload } from "@/domains/session/api/session-resources";
import { toProjectId, toSessionId } from "@/routes/typed-id";

export interface UploadedSessionResource {
  id: string;
  name: string;
  path: string;
}

export async function uploadSessionResource(
  projectId: string | null,
  sessionId: string,
  file: File,
): Promise<UploadedSessionResource> {
  if (projectId === null) {
    throw new Error("Project id is required to upload session resources.");
  }

  const upload = await addSessionResourceUpload(
    toProjectId(projectId),
    toSessionId(sessionId),
    file,
  );

  await runUploadSession(upload, file);
  return {
    id: upload.fileId,
    name: file.name,
    path: upload.path,
  };
}
