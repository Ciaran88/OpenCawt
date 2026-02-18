export class WorkerMintError extends Error {
  readonly code: string;
  readonly metadataUri?: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; metadataUri?: string; retryable?: boolean }) {
    super(input.message);
    this.name = "WorkerMintError";
    this.code = input.code;
    this.metadataUri = input.metadataUri;
    this.retryable = input.retryable ?? true;
  }
}

export function asWorkerMintError(error: unknown): WorkerMintError | null {
  if (error instanceof WorkerMintError) {
    return error;
  }
  return null;
}
