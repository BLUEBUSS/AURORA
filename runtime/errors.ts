export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
export const invalidPath = () => new HttpError(400, "INVALID_PATH", "请选择工作区内的有效文件路径。");
