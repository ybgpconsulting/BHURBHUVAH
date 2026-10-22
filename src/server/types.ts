export type Env = {
  Bindings: {
    DB: D1Database;
    APP_ENV?: string;
    SESSION_SECRET?: string;
    SETUP_SECRET?: string;
    AUTOMATION_API_TOKEN?: string;
    DISPATCH_GENERATION_TIME?: string;
    DISPATCH_AUTO_PUBLISH?: string;
  };
  Variables: {
    user: { id: string; email: string; name: string; role: string } | null;
  };
};
