import { runUploadSession } from "@/domains/file/api/file-upload-client";
import { addSessionResourceUpload } from "@/domains/session/api/session-resources";
import { toSessionId } from "@/routes/typed-id";

export interface UploadedSessionResource {
  id: string;
  name: string;
  path: string;
}

export async function uploadSessionResource(
  sessionId: string,
  file: File,
): Promise<UploadedSessionResource> {
  const upload = await addSessionResourceUpload(toSessionId(sessionId), file);

  await runUploadSession(upload, file);
  return {
    id: upload.fileId,
    name: file.name,
    path: upload.path,
  };
}
