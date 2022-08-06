import { Client } from "@notionhq/client";
import * as dotenv from "dotenv";
import * as _ from "lodash";
import { NumberPropertyItemObjectResponse, PageObjectResponse, QueryDatabaseParameters, QueryDatabaseResponse } from "@notionhq/client/build/src/api-endpoints";
import { Octokit } from "octokit";
import { ISSUE_COLUMN, ExtractedGitHubIssue, extractIssuePropsFrom, notionPagePropertiesFrom } from "./schema";

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
const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

init().then(transferGitHubDataToNotionDb);

/**
 * Get issues currently stored in the Notion database.
 */
async function init(): Promise<Map<number, string>> {
    const currentNotionIssues = await getPagesFromNotionDatabase();

    const gitHubIssuesIdToNotionPageId = new Map<number, string>;

    for (const { pageId, issueId: issueNumber } of currentNotionIssues) {
        gitHubIssuesIdToNotionPageId.set(issueNumber, pageId);
    }

    return gitHubIssuesIdToNotionPageId;
}

async function transferGitHubDataToNotionDb(gitHubIssuesIdToNotionPageId: Map<number, string>) {
    // Get all issues currently in the provided GitHub repository.
    console.log("\nFetching issues from Github ...");
    const issues = await getIssuesFromGitHub();
    console.log(`Fetched ${issues.length} issues from GitHub repository.`);

    // Group issues into those that need to be created or updated in the Notion database.
    const { issuesToCreate, issuesToUpdate } = getNotionOperations(issues, gitHubIssuesIdToNotionPageId);

    // Create pages for new issues.
    console.log(`\n${issuesToCreate.length} new issues to add to Notion.`);
    await createPagesFrom(issuesToCreate);

    // Updates pages for existing issues.
    console.log(`\n${issuesToUpdate.length} issues to update in Notion.`);
    await updatePagesFrom(issuesToUpdate);

    // Success!
    console.log("\n✅ Notion database is in sync with GitHub again.");
}

/**
 * Gets pages from the Notion database.
 * @see https://developers.notion.com/docs/working-with-databases
 *
 */
async function getPagesFromNotionDatabase(): Promise<NotionPageMetadata[]> {
    console.log("\nFetching issues from Notion ...");

    const pages: PageObjectResponse[] = [];

    let cursor: QueryDatabaseParameters["start_cursor"] = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const query: QueryDatabaseResponse = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
        });
        const { next_cursor, results } = query;

        pages.push(...results as PageObjectResponse[]);
        if (!next_cursor) {
            break;
        }
        cursor = next_cursor;
    }
    console.log(`Fetched ${pages.length} issues from Notion DB.`);
    console.log("\nFetching metadata from Notion ...");

    const notionDbEntries: NotionPageMetadata[] = [];

    for (const page of pages) {
        const issueNumberPropertyId = page.properties[ISSUE_COLUMN].id;
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
async function getIssuesFromGitHub(): Promise<ExtractedGitHubIssue[]> {
    console.log("\nFetching metadata from GitHub ...");

    const issues: ExtractedGitHubIssue[] = [];

    const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
        owner,
        repo,
        state: "all",
        per_page: 100,
    });

    for await (const { data } of iterator) {
        for (const issue of data) {
            if (!!issue && !isString(issue) && !issue.pull_request) {
                issues.push(extractIssuePropsFrom(issue));
                console.log(`Fetched GitHub data for issue ${issue.number}`);
            }
        }
    }
    return issues;
}

const isString = (value: unknown): value is string => value instanceof String;

/**
 * Determines which issues already exist in the Notion database.
 *
 */
function getNotionOperations(issues: ExtractedGitHubIssue[], gitHubIssuesIdToNotionPageId: Map<number, string>) {
    const issuesToCreate: ExtractedGitHubIssue[] = [];
    const issuesToUpdate: (ExtractedGitHubIssue & { pageId: string })[] = [];
    for (const issue of issues) {
        const pageId = gitHubIssuesIdToNotionPageId.get(issue.id);
        if (pageId) {
            issuesToUpdate.push({
                ...issue,
                pageId,
            });
        } else {
            issuesToCreate.push(issue);
        }
    }
    return { issuesToCreate, issuesToUpdate };
}

/**
 * Creates new pages in Notion.
 *
 * https://developers.notion.com/reference/post-page
 *
 */
async function createPagesFrom(issues: ExtractedGitHubIssue[]) {
    const createChunks = _.chunk(issues, OPERATION_BATCH_SIZE);
    for (const createBatch of createChunks) {
        await Promise.all(
            createBatch.map(issue =>
                notion.pages.create({
                    parent: { database_id: databaseId },
                    properties: notionPagePropertiesFrom(issue),
                })
            )
        );
        console.log(`Completed batch size: ${createBatch.length}`);
    }
}

/**
 * Updates provided pages in Notion.
 *
 * https://developers.notion.com/reference/patch-page
 *
 */
async function updatePagesFrom(issues: (ExtractedGitHubIssue & { pageId: string })[]) {
    const updateChunks = _.chunk(issues, OPERATION_BATCH_SIZE);
    for (const updateBatch of updateChunks) {
        await Promise.all(
            updateBatch.map(({ pageId, ...issue }) =>
                notion.pages.update({
                    page_id: pageId,
                    properties: notionPagePropertiesFrom(issue),
                })
            )
        );
        console.log(`Completed batch size: ${updateBatch.length}`);
    }
}