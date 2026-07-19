import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 não encaminha rejeições de Promise para o error handler sozinho.
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}
