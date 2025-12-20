interface Author {
	nickname: string;
}

interface Article {
	id: number;
	title: string;
	free: boolean;
	author: Author;
	released_time: number;
	summary: string;
}

interface ResponseArticles<T> {
	error: number;
	data: T[];
	total: number;
}

async function getUserArticles(slug: string) {
	let response;
	let res: ResponseArticles<Article>;
	let total = 0;
	response = await fetch(`https://sspai.com/api/v1/article/user/public/page/get?slug=${slug}&object_type=0`);
	if (response.status === 200) {
		res = await response.json();
		if (res.error === 0) {
			total = res.total;
		}
	}

	if (total !== 0) {
		response = await fetch(`https://sspai.com/api/v1/article/user/public/page/get?slug=${slug}&object_type=0&offset=0&limit=${total}`);
		if (response.status === 200) {
			res = await response.json();
			const articles = res.data.map(({ id, title, free, author: { nickname }, released_time, summary }) => ({
				title: free ? title : `[$] ${title}`,
				link: `https://sspai.com/post/${id}`,
				author: nickname,
				pubDate: released_time * 1000,
				summary,
			}));

			return articles;
		}
	}
}

export default {
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);
		const author = url.pathname !== '/' ? url.pathname.slice(1) : '';
		if (author === '') {
			return new Response('Can not find this author');
		}
		const articles = await getUserArticles(author);
		if (articles) {
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
			return new Response(JSON.stringify(jsonFeed));
		} else {
			return new Response('Can not get articles of this author');
		}
	},
} satisfies ExportedHandler<Env>;
