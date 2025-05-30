// src/types/express-override.d.ts

import * as core from 'express-serve-static-core';

declare module 'express' {
  function e(): core.Express;
  namespace e {
    export import Application   = core.Express;
    export import Router        = core.Router;
    export import Request       = core.Request;
    export import Response      = core.Response;
    export import NextFunction  = core.NextFunction;
  }
  export = e;
}
