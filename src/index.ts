/* ================================================================================

	notion-github-sync.
  
  Glitch example: https://glitch.com/edit/#!/notion-github-sync
  Find the official Notion API client @ https://github.com/makenotion/notion-sdk-js/

================================================================================ */
import {Client} from "@notionhq/client";
import * as dotenv from "dotenv";
import * as _  from "lodash";
import { CreatePageParameters, NumberPropertyItemObjectResponse, PageObjectResponse, QueryDatabaseParameters, QueryDatabaseResponse, UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { Octokit } from "octokit";

type GithubIssue = {
  id: number,
  title: string,
  state: string,
  comment_count: number,
  url: string, 
}

type NotionPageMetadata = { pageId: string, issueId: number }

const OPERATION_BATCH_SIZE = 10;


dotenv.config();
if (!process.env.NOTION_DATABASE_ID) throw new Error("Notion database must be defined");
if (!process.env.GITHUB_REPO_OWNER) throw new Error("Github repo owner must be defined");
if (!process.env.GITHUB_REPO_NAME) throw new Error("Github repo name must be defined");
if (!process.env.GITHUB_KEY) throw new Error("Github api key must be defined");
if (!process.env.NOTION_KEY) throw new Error("Notion api key must be defined");

const octokit = new Octokit({ auth: process.env.GITHUB_KEY });
const notion = new Client({ auth: process.env.NOTION_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Local map to store GitHub issue ID to its corresponding Notion pageId.
 */
const gitHubIssuesIdToNotionPageId = new Map<number,string>;

/**
 * Initialize local data store.
 * Then sync with GitHub.
 */
setInitialGitHubToNotionIdMap().then(syncNotionDatabaseWithGitHub);

/**
 * Get and set the initial data store with issues currently in the database.
 */
async function setInitialGitHubToNotionIdMap() {
    const currentIssues = await getPagesFromNotionDatabase();

    for (const { pageId, issueId: issueNumber } of currentIssues) {
        gitHubIssuesIdToNotionPageId.set(issueNumber,pageId);
    }
}

async function syncNotionDatabaseWithGitHub() {
    // Get all issues currently in the provided GitHub repository.
    console.log("\nFetching issues from Github ...");
    const issues = await getGitHubIssuesForRepository();
    console.log(`Fetched ${issues.length} issues from GitHub repository.`);

    // Group issues into those that need to be created or updated in the Notion database.
    const { pagesToCreate, pagesToUpdate } = getNotionOperations(issues);

    // Create pages for new issues.
    console.log(`\n${pagesToCreate.length} new issues to add to Notion.`);
    await createPages(pagesToCreate);

    // Updates pages for existing issues.
    console.log(`\n${pagesToUpdate.length} issues to update in Notion.`);
    await updatePages(pagesToUpdate);

    // Success!
    console.log("\n✅ Notion database is synced with GitHub.");
}

/**
 * Gets pages from the Notion database.
 *
 */
async function getPagesFromNotionDatabase() : Promise<NotionPageMetadata[]> {
    console.log("\nFetching issues from Notion ...");

    const pages : PageObjectResponse[] = [];
    
    let cursor: QueryDatabaseParameters["start_cursor"] = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const response : QueryDatabaseResponse = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
        });
        const { next_cursor,results } = response;

        pages.push(...(results as PageObjectResponse[]));
        if (!next_cursor) {
            break;
        }
        cursor = next_cursor;
    }
    console.log(`Fetched ${pages.length} issues from Notion DB.`);
    console.log("\nFetching metadata from Notion ...");

    const notionDbEntries : NotionPageMetadata[] = [];
    for (const page of pages) {
        const issueNumberPropertyId = page.properties["Issue Number"].id;
        const propertyResult = await notion.pages.properties.retrieve({
            page_id: page.id,
            property_id: issueNumberPropertyId,
        }) as NumberPropertyItemObjectResponse;
    
        if (propertyResult.number) {
            notionDbEntries.push({
                pageId: page.id,
                issueId: propertyResult.number,
            });
            console.log(`Fetched Notion metadata for GitHub issue ${propertyResult.number}`);
        }
    }

    return notionDbEntries;
}

/**
 * Gets issues from a GitHub repository. Pull requests are omitted.
 *
 * https://docs.github.com/en/rest/guides/traversing-with-pagination
 * https://docs.github.com/en/rest/reference/issues
 *
 */
async function getGitHubIssuesForRepository() : Promise<GithubIssue[]> {
    console.log("\nFetching metadata from GitHub ...");

    const issues : GithubIssue[] = [];

    const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
        owner: process.env.GITHUB_REPO_OWNER,
        repo: process.env.GITHUB_REPO_NAME,
        state: "all",
        per_page: 100,
    });

    for await (const { data } of iterator) {
        for (const issue of data) {
            if (!!issue && !isString(issue) && !issue.pull_request) {
                issues.push({
                    id: issue.number,
                    title: issue.title,
                    state: issue.state,
                    comment_count: issue.comments,
                    url: issue.html_url,
                });
                console.log(`Fetched GitHub data for issue ${issue.number}`);
            }
        }
    }
    return issues;
}

const isString = (value: unknown) : value is string => value instanceof String;

/**
 * Determines which issues already exist in the Notion database.
 *
 */
function getNotionOperations(issues : GithubIssue[]) {
    const pagesToCreate = [];
    const pagesToUpdate = [];
    for (const issue of issues) {
        const pageId = gitHubIssuesIdToNotionPageId.get(issue.id);
        if (pageId) {
            pagesToUpdate.push({
                ...issue,
                pageId,
            });
        } else {
            pagesToCreate.push(issue);
        }
    }
    return { pagesToCreate, pagesToUpdate };
}

/**
 * Creates new pages in Notion.
 *
 * https://developers.notion.com/reference/post-page
 *
 */
async function createPages(pagesToCreate : GithubIssue[]) {
    const pagesToCreateChunks = _.chunk(pagesToCreate, OPERATION_BATCH_SIZE);
    for (const pagesToCreateBatch of pagesToCreateChunks) {
        await Promise.all(
            pagesToCreateBatch.map(issue =>
                notion.pages.create({
                    parent: { database_id: databaseId },
                    properties: getPropertiesFromIssue(issue),
                })
            )
        );
        console.log(`Completed batch size: ${pagesToCreateBatch.length}`);
    }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 */
async function updatePages(pagesToUpdate : (GithubIssue & {pageId: string})[]) {
    const pagesToUpdateChunks = _.chunk(pagesToUpdate, OPERATION_BATCH_SIZE);
    for (const pagesToUpdateBatch of pagesToUpdateChunks) {
        await Promise.all(
            pagesToUpdateBatch.map(({ pageId, ...issue }) =>
                notion.pages.update({
                    page_id: pageId,
                    properties: getPropertiesFromIssue(issue),
                })
            )
        );
        console.log(`Completed batch size: ${pagesToUpdateBatch.length}`);
    }
}

//*========================================================================
// Helpers
//*========================================================================

/**
 * Returns the GitHub issue to conform to this database's schema properties.
 *
 */
function getPropertiesFromIssue(issue : GithubIssue) : CreatePageParameters["properties"] & UpdatePageParameters["properties"]  {
    const { title, id: number, state, comment_count, url } = issue;
    return {
        "Name": {
            title: [{ type: "text", text: { content: title } }],
        },
        "Issue Number": {
            number,
        },
        State: {
            select: { name: state },
        },
        "Number of Comments": {
            number: comment_count,
        },
        "Issue URL": {
            url,
        },
    };
}