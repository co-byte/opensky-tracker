/**
 * Welcome to Cloudflare Workers!
 *
 *
 * - Run `npm run dev` to start a development server
 * - Run `npm run deploy` to publish the Worker
 *
 * Bind resources to the Worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Secrets Store bindings (see `secrets_store_secrets` in wrangler.jsonc)
	DATABRICKS_ACCOUNT_ID: SecretsStoreSecret; // part of the OAuth token endpoint URL
	DATABRICKS_DEPLOYMENT_NAME: SecretsStoreSecret; // subdomain of the workspace URL: <deployment name>.cloud.databricks.com
	DATABRICKS_WAREHOUSE_ID: SecretsStoreSecret;
	DATABRICKS_CLIENT_ID: SecretsStoreSecret;
	DATABRICKS_CLIENT_SECRET: SecretsStoreSecret;
	FLIGHT_CACHE: KVNamespace;
	FLIGHT_CACHE_TTL_SECONDS: number;
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
	manifest?: {
		schema?: {
			columns?: { name: string; type_name?: string }[];
		};
	};
	result?: {
		data_array?: unknown[][];
		[key: string]: unknown;
	};
}

async function loadConfig(env: Env): Promise<{
	auth: DatabricksAuthConfig;
	sql: DatabricksSqlConfig;
}> {
	const required = (value: string | undefined, name: string): string => {
		if (!value) {
			throw new Error(`Missing required environment variable: ${name}`);
		}
		return value;
	};

	const accountId = required(await env.DATABRICKS_ACCOUNT_ID.get(), 'DATABRICKS_ACCOUNT_ID');
	const deploymentName = required(await env.DATABRICKS_DEPLOYMENT_NAME.get(), 'DATABRICKS_DEPLOYMENT_NAME');

	return {
		auth: {
			tokenEndpointUrl: `https://accounts.cloud.databricks.com/oidc/accounts/${accountId}/v1/token`,
			clientId: required(await env.DATABRICKS_CLIENT_ID.get(), 'DATABRICKS_CLIENT_ID'),
			clientSecret: required(await env.DATABRICKS_CLIENT_SECRET.get(), 'DATABRICKS_CLIENT_SECRET'),
		},
		sql: {
			serverHostname: `${deploymentName}.cloud.databricks.com`,
			warehouseId: required(await env.DATABRICKS_WAREHOUSE_ID.get(), 'DATABRICKS_WAREHOUSE_ID'),
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

async function fetchLatestFlightState(env: Env): Promise<DatabricksQueryResult> {
	const { auth, sql } = await loadConfig(env);
	const accessToken = await getAccessToken(auth);
	return runQuery(sql, accessToken, 'SELECT longitude, latitude, geo_altitude, category, true_track, vertical_rate, velocity, icao24, callsign FROM intro_to_data_engineering.gold.latest_flight_state');
}

async function getLatestFlightStateJson(env: Env, ctx: ExecutionContext): Promise<string> {
	const key = 'latest-flight-state';
	const cached = await env.FLIGHT_CACHE.get(key);
	if (cached) {
		return cached;
	}

	const json = JSON.stringify(await fetchLatestFlightState(env));
	ctx.waitUntil(env.FLIGHT_CACHE.put(key, json, { expirationTtl: env.FLIGHT_CACHE_TTL_SECONDS }));
	return json;
}

type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Handler> = {
	'GET /api/latest-flight-state': async (_req, env, ctx) =>
		new Response(await getLatestFlightStateJson(env, ctx), { headers: { 'Content-Type': 'application/json' } }),
};

export default {
	async fetch(req, env, ctx): Promise<Response> {
		const handler = routes[`${req.method} ${new URL(req.url).pathname}`];
		if (!handler) {
			return Response.json({ error: 'Not found' }, { status: 404 });
		}

		return handler(req, env, ctx);
	},
} satisfies ExportedHandler<Env>;
