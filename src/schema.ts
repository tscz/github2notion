import { CreatePageParameters, UpdatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import { components } from "@octokit/openapi-types";
import { isString } from "lodash";

export type ExtractedGitHubIssue = {
    id: number,
    title: string,
    state: "open" | "closed",
    url: string,
    created_at: string,
    type?: "Bug" | "Tech Debt"
    priority?: "Low Priority" | "High Priority",
    description?: string | null
}

type GitHubLabel = components["schemas"]["issue"]["labels"];
type GitHubIssue = components["schemas"]["issue"];

export function extractIssuePropsFrom(issue: GitHubIssue): ExtractedGitHubIssue {
    return {
        id: issue.number,
        title: issue.title,
        state: issue.state as "open" | "closed",
        url: issue.html_url,
        created_at: issue.created_at,
        priority: getPriorityFrom(issue.labels),
        type: getTypeFrom(issue.labels),
        description: issue.body?.substring(0, 1999)
    };
}

export const ISSUE_COLUMN = "Issue Number";

/**
 * Returns the GitHub issue to conform to this database's schema properties.
 *
 */
export function notionPagePropertiesFrom(issue: ExtractedGitHubIssue): CreatePageParameters["properties"] & UpdatePageParameters["properties"] {
    return {
        "Name": {
            title: [{ type: "text", text: { content: issue.title } }],
        },
        [ISSUE_COLUMN]: {
            number: issue.id,
        },
        "State": {
            select: { name: issue.state },
        },
        "Issue URL": {
            url: issue.url,
        },
        "Created At": {
            date: { start: issue.created_at }
        },
        ...(!!issue.priority && {
            Priority: {
                select: { name: issue.priority },
            }
        })
        ,
        ...(!!issue.type && {
            "Type": {
                select: { name: issue.type },
            }
        }),
        ...(!!issue.description && {
            "Description": {
                rich_text: [{ type: "text", text: { content: issue.description } }],
            }
        }),
    };
}

function getPriorityFrom(labels: GitHubLabel): ExtractedGitHubIssue["priority"] {
    return has(labels, "Low Priority") ? "Low Priority" : has(labels, "High Priority") ? "High Priority" : undefined;
}
function getTypeFrom(labels: GitHubLabel): ExtractedGitHubIssue["type"] {
    return has(labels, "Bug") ? "Bug" : has(labels, "Tech Debt") ? "Tech Debt" : undefined;
}

const has = (labels: GitHubLabel, id: string) => labels.filter(isLabelObject).some(label => label.name === id);
const isLabelObject = (value: unknown): value is Exclude<GitHubLabel[0], string> => !isString(value);
