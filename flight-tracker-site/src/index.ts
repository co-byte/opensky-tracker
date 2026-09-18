/**
 * Welcome to Cloudflare Workers!
 *
 * This is a template for a Scheduled Worker: a Worker that can run on a
 * configurable interval:
 * https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/
 *
 * - Run `npm run dev` to start a development server
 * - Run `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"` to see the Worker in action
 * - Run `npm run deploy` to publish the Worker
 *
 * Bind resources to the Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Secrets (set via `wrangler secret put`)
	DATABRICKS_ACCOUNT_ID: string; // part of the OAuth token endpoint URL
	DATABRICKS_DEPLOYMENT_NAME: string; // subdomain of the workspace URL: <deployment name>.cloud.databricks.com
	DATABRICKS_WAREHOUSE_ID: string;
	DATABRICKS_CLIENT_ID: string;
	DATABRICKS_CLIENT_SECRET: string;
}

interface DatabricksAuthConfig {
	tokenEndpointUrl: string;
	clientId: string;
	clientSecret: string;
}

interface DatabricksSqlConfig {
	serverHostname: string;
	warehouseId: string;
}

interface DatabricksQueryResult {
	statement_id: string;
	status: { state: string };
	result?: {
		data_array?: unknown[][];
		[key: string]: unknown;
	};
}

function loadConfig(env: Env): {
	auth: DatabricksAuthConfig;
	sql: DatabricksSqlConfig;
} {
	const required = (value: string | undefined, name: string): string => {
		if (!value) {
			throw new Error(`Missing required environment variable: ${name}`);
		}
		return value;
	};

	const accountId = required(env.DATABRICKS_ACCOUNT_ID, 'DATABRICKS_ACCOUNT_ID');
	const deploymentName = required(env.DATABRICKS_DEPLOYMENT_NAME, 'DATABRICKS_DEPLOYMENT_NAME');

	return {
		auth: {
			tokenEndpointUrl: `https://accounts.cloud.databricks.com/oidc/accounts/${accountId}/v1/token`,
			clientId: required(env.DATABRICKS_CLIENT_ID, 'DATABRICKS_CLIENT_ID'),
			clientSecret: required(env.DATABRICKS_CLIENT_SECRET, 'DATABRICKS_CLIENT_SECRET'),
		},
		sql: {
			serverHostname: `${deploymentName}.cloud.databricks.com`,
			warehouseId: required(env.DATABRICKS_WAREHOUSE_ID, 'DATABRICKS_WAREHOUSE_ID'),
		},
	};
}

async function getAccessToken(auth: DatabricksAuthConfig): Promise<string> {
	const response = await fetch(auth.tokenEndpointUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: 'Basic ' + btoa(`${auth.clientId}:${auth.clientSecret}`),
		},
		body: 'grant_type=client_credentials&scope=sql',
	});

	if (!response.ok) {
		throw new Error(`Access token request failed: ${response.status} ${await response.text()}`);
	}

	const data = (await response.json()) as { access_token: string };
	return data.access_token;
}

async function runQuery(sql: DatabricksSqlConfig, accessToken: string, sqlText: string): Promise<DatabricksQueryResult> {
	const response = await fetch(`https://${sql.serverHostname}/api/2.0/sql/statements`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
		body: JSON.stringify({
			warehouse_id: sql.warehouseId,
			statement: sqlText,
			wait_timeout: '30s',
		}),
	});

	if (!response.ok) {
		throw new Error(`Query run request failed: ${response.status} ${await response.text()}`);
	}

	return (await response.json()) as DatabricksQueryResult;
}

async function pollFlightData(env: Env): Promise<void> {
	const { auth, sql } = loadConfig(env);
	const accessToken = await getAccessToken(auth);
	const result = await runQuery(sql, accessToken, 'SELECT * FROM intro_to_data_engineering.gold.latest_flight_state');

	console.log(JSON.stringify(result.result));
}

export default {
	async fetch(req) {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`);
	},

	// The scheduled handler is invoked at the interval set by the `triggers`
	// configuration in wrangler.jsonc.
	async scheduled(event, env, ctx): Promise<void> {
		ctx.waitUntil(pollFlightData(env).catch((err) => console.error(`trigger fired at ${event.cron} failed: ${err}`)));
	},
} satisfies ExportedHandler<Env>;
