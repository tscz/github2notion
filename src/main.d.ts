declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NOTION_DATABASE_ID: string;
      GITHUB_REPO_OWNER: string;
      GITHUB_REPO_NAME: string;
      GITHUB_KEY: string;
      NOTION_KEY: string;
    }
  }
}

export {};
