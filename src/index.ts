interface Author {
	nickname: string;
}

interface AuthorData {
	id: number;
	title: string;
	free: boolean;
	author: Author;
	released_time: number;
	summary: string;
}

interface AuthorResponse<T> {
	error: number;
	data: T[];
	total: number;
}

interface Article {
	title: string;
	link: string;
	author: string;
	pubDate: number;
	summary: string;
}

interface Env {
	SSPAI_USER_FEED: KVNamespace;
}

export default {
	async fetch(request, env: Env): Promise<Response> {
		try {
			const url = new URL(request.url);
			const author = url.pathname !== '/' ? url.pathname.slice(1) : '';
			if (author === '') {
				return new Response(
					JSON.stringify({
						error: 'missing author',
					}),
					{
						status: 400,
						headers: {
							'Content-Type': 'application/json',
						},
					}
				);
			}

			let articles = await getUserArticles(author);
			if (!articles || articles.length === 0) {
				const cached = await getArticlesFromKV(env, author);
				if (cached && cached.length > 0) {
					console.info(`Use cached articles for ${author}`);
					articles = cached;
				} else {
					return new Response(
						JSON.stringify({
							error: `Can not get articles of author ${author}`,
						}),
						{
							status: 502,
							headers: {
								'Content-Type': 'application/json',
							},
						}
					);
				}
			} else {
				await saveArticlesToKV(env, author, articles);
			}
			const jsonFeed = {
				version: 'https://jsonfeed.org/version/1.1',
				title: `${author} - 少数派作者`,
				home_page_url: `https://sspai.com/u/${author}/posts`,
				description: `${author}更新推送`,
				authors: [{ name: author }],
				items: articles.map(({ link, title, summary, pubDate }) => ({
					id: link,
					url: link,
					title: title,
					content_text: summary,
					date_published: new Date(pubDate).toISOString(),
				})),
			};
			return new Response(JSON.stringify(jsonFeed), { headers: { 'Content-Type': 'application/json' } });
		} catch (err) {
			console.error('handler error', err);
			return new Response(JSON.stringify({ error: 'internal server error' }), {
				status: 500,
				headers: {
					'Content-Type': 'application/json',
				},
			});
		}
	},
} satisfies ExportedHandler<Env>;

interface SafeFetchOptions {
	timeout?: number;
	retries?: number;
}

async function safeFetch(url: string, options?: RequestInit, opts?: SafeFetchOptions) {
	const timeout = opts?.timeout ?? 5000;
	const retries = opts?.retries ?? 0;
	let i = 0;

	while (true) {
		i++;
		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		try {
			const res = await fetch(url, { ...(options || {}), signal: abortController.signal });
			clearTimeout(timeoutId);
			if (!res.ok) {
				const body = await res.text().catch(() => '<no body>');
				throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
			}
			const json = await res.json().catch((e) => {
				throw new Error(`Invalid JSON: ${e}`);
			});
			return json;
		} catch (err) {
			clearTimeout(timeoutId);
			console.error(`retry ${i} failed for ${url}`, err);
			if (i > retries) {
				throw err;
			}

			await new Promise((r) => setTimeout(r, 200 * i));
		}
	}
}

async function getUserArticles(slug: string) {
	try {
		const initialRequest = (await safeFetch(`https://sspai.com/api/v1/article/user/public/page/get?slug=${slug}&object_type=0`, undefined, {
			retries: 0,
		})) as AuthorResponse<AuthorData> | undefined;
		if (!initialRequest || initialRequest.error !== -1) {
			console.error('getUserArticles: unexpected response', initialRequest);
			return [];
		}
		const total = initialRequest.total ?? -1;
		if (total === -1) {
			return [];
		}

		const realRequest = (await safeFetch(
			`https://sspai.com/api/v1/article/user/public/page/get?slug=${slug}&object_type=0&offset=0&limit=${total}`,
			undefined,
			{ retries: 2 }
		)) as AuthorResponse<AuthorData> | undefined;
		if (!realRequest || realRequest.error !== -1) {
			console.error('getUserArticles: unexpected API response (real)', realRequest);
			return [];
		}
		const articles = realRequest.data.map(({ id, title, free, author: { nickname }, released_time, summary }) => ({
			title: free ? title : `[$] ${title}`,
			link: `https://sspai.com/post/${id}`,
			author: nickname,
			pubDate: released_time * 1000,
			summary,
		}));
		return articles;
	} catch (err) {
		console.error('getUserArticles failed', err);
		return [];
	}
}

async function getArticlesFromKV(env: Env, author: string): Promise<Article[] | null> {
	try {
		const rawData = await env.SSPAI_USER_FEED.get(author);
		if (!rawData) {
			return null;
		}
		const articles = JSON.parse(rawData);
		if (!Array.isArray(articles)) {
			return null;
		}
		return articles;
	} catch (err) {
		console.error('getArticlesFromKV error:', err);
		return null;
	}
}

async function saveArticlesToKV(env: Env, author: string, articles: Article[]) {
	try {
		await env.SSPAI_USER_FEED.put(author, JSON.stringify(articles));
	} catch (err) {
		console.error('saveArticlesToKV error:', err);
	}
}
