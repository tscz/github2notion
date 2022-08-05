# github2notion
Exports github issues and other metadata into notion.so database

is a typescript based implementation based on https://github.com/makenotion/notion-sdk-js/tree/main/examples/notion-github-sync. 


## About the Integration

This Notion integration syncs GitHub Issues for a specific repo to a Notion Database. This integration was built using this [database template](https://www.notion.com/367cd67cfe8f49bfaf0ac21305ebb9bf?v=bc79ca62b36e4c54b655ceed4ef06ebd) and [GitHub's Octokit Library](https://github.com/octokit). Changes made to issues in the Notion database will not be reflected in GitHub. For an example which allows you to take actions based on changes in a database [go here.](https://github.com/makenotion/notion-sdk-js/tree/main/examples/database-email-update)

## Running Locally

### 1. Setup your local project

```zsh
# Clone this repository locally
git clone https://github.com/tscz/github2notion

# Switch into this project
cd github2notion

# Install the dependencies
npm install
```

### 2. Set your environment variables in a `.env` file

```zsh
GITHUB_KEY=<your-github-personal-access-token>
NOTION_KEY=<your-notion-api-key>
NOTION_DATABASE_ID=<notion-database-id>
GITHUB_REPO_OWNER=<github-owner-username>
GITHUB_REPO_NAME=<github-repo-name>
```

You can create your Notion API key [here](https://www.notion.com/my-integrations).

You can create your GitHub Personal Access token by following the guide [here](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token).

To create a Notion database that will work with this example, duplicate [this empty database template](https://www.notion.com/367cd67cfe8f49bfaf0ac21305ebb9bf?v=bc79ca62b36e4c54b655ceed4ef06ebd).

### 3. Run code

```zsh
npm run start
```