import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Parses req.body (or query) with a zod schema; the parsed value replaces the original so handlers see clean data. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) return next(r.error);
    req.body = r.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.query ?? {});
    if (!r.success) return next(r.error);
    res.locals.query = r.data;
    next();
  };
}

/** Wraps an async handler so rejections reach the error handler (Express 5 does this too; explicit for clarity). */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
