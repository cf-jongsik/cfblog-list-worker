import puppeteer, { BrowserWorker, ActiveSession, Browser } from '@cloudflare/puppeteer';

interface HTMLElement {
	innerText: string;
	href: string;
}

type MsgBody = {
	action: string;
	url: string;
	text: string;
};

async function getRandomSession(endpoint: BrowserWorker): Promise<string | null> {
	const sessions: ActiveSession[] = await puppeteer.sessions(endpoint);
	console.log(`Sessions: ${JSON.stringify(sessions)}`);
	const sessionsIds = sessions
		.filter((v) => {
			return !v.connectionId; // remove sessions with workers connected to them
		})
		.map((v) => {
			return v.sessionId;
		});
	if (sessionsIds.length === 0) {
		return null;
	}

	const sessionId = sessionsIds[Math.floor(Math.random() * sessionsIds.length)];

	return sessionId!;
}

export default {
	async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
		if (batch.queue !== 'cfblog-list-queue') return;
		for (const message of batch.messages) {
			const msg = message.body as MsgBody;
			const action = msg.action;
			const blogURL = msg.url;
			const txt = msg.text;
			const cache = await env['cfblog-summary'].get(blogURL);
			if (cache) {
				console.log('cache hit, skip', blogURL, cache);
				return;
			}

			switch (action) {
				case 'fetch': {
					console.log('fetch start', blogURL);
					let sessionId = await getRandomSession(env.BROWSER);
					let browser: Browser | undefined;
					if (sessionId) {
						try {
							browser = await puppeteer.connect(env.BROWSER, sessionId);
						} catch (e) {
							message.retry({ delaySeconds: 10 });
							break;
						}
					}
					console.log('sessionID', sessionId);
					if (!browser) {
						browser = await puppeteer.launch(env.BROWSER, { keep_alive: 600000 });
					}
					const page = await browser.newPage();
					await page.goto(blogURL);
					const txt = await page.$eval('*', (ele: HTMLElement) => {
						return ele.innerText;
					});

					await page.close();
					browser.disconnect();
					if (txt) {
						await env.queue.send({ action: 'summarize', url: blogURL, text: txt } as MsgBody);
						console.log('fetch done', blogURL);
					} else {
						console.log('fetch fail: missing response from AI', blogURL);
						return;
					}
					break;
				}
				case 'translate': {
					console.log('translate start', blogURL);
					if (!txt) {
						return;
					}

					const sentences: string[] = txt.split('\n');

					const promisedTxt = sentences.map(async (sentence: string) => {
						if (!sentence) {
							return '\n';
						}
						const res = await env.AI.run('@cf/meta/m2m100-1.2b', {
							text: sentence,
							source_lang: 'en',
							target_lang: 'ko',
						} as AiTranslationInput);

						return res.translated_text ?? sentence;
					});
					let returnTxt: string | undefined = '';
					(await Promise.all(promisedTxt)).forEach((txt: string) => {
						returnTxt += '\n';
						returnTxt += txt;
					});

					if (returnTxt) {
						ctx.waitUntil(env['cfblog-summary'].put(blogURL, returnTxt));
						console.log('translate done', blogURL);
					} else {
						console.log('translate fail: missing response from AI', blogURL);
						return;
					}
					break;
				}
				case 'summarize': {
					console.log('summarize start', blogURL);
					if (!txt) {
						return;
					}

					const messages = [
						{ role: 'system', content: 'summarize provided document' },
						{
							role: 'user',
							content: txt,
						},
					];

					const res = (await env.AI.run(
						'@cf/meta/llama-3.2-3b-instruct' as BaseAiTextGenerationModels,
						{ messages, stream: false } as AiTextGenerationInput
					)) as { response?: string };

					if (res.response) {
						await env.queue.send({ action: 'translate', url: blogURL, text: res.response } as MsgBody);
						console.log('summarize done', blogURL);
					} else {
						console.log('summarize fail: missing response from AI', blogURL);
						return;
					}
					break;
				}
				default: {
				}
			}
		}
	},
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'GET') {
			const url = new URL(request.url);
			const start = url.searchParams.get('start');
			if (!start) return new Response(null, { status: 400 });

			const end = url.searchParams.get('end');
			if (!end) return new Response(null, { status: 400 });

			const startPage = parseInt(start);
			const endPage = parseInt(end);
			const browser = await puppeteer.launch(env.BROWSER);

			let result = {};

			for (let currentPage = startPage; currentPage < endPage; currentPage++) {
				const baseURL = new URL('https://blog.cloudflare.com/page/');
				baseURL.pathname = baseURL.pathname + currentPage;

				const page = await browser.newPage();
				const metric = page.metrics();
				await page.goto(baseURL.toString());
				const posts = await page.$$eval('#main-body > astro-island > article > div > a', (elements: HTMLElement[]) =>
					elements.map((element) => element.href)
				);
				let counter = 0;

				for (const post of posts) {
					const tempUrl = new URL(post);
					await env['cf-blog-list'].put(post, tempUrl.pathname.substring(1));
					result = {
						...result,
						[currentPage + '-' + counter++]: tempUrl.pathname.substring(1),
					};
				}

				ctx.waitUntil(page.close());
			}

			ctx.waitUntil(browser.close());

			return Response.json(result);
		} else if (request.method === 'POST') {
			const list = await env['cf-blog-list'].list();
			let json = {};
			for (const key of list.keys) {
				json = { ...json, [key.name]: '' };
				await env.queue.send({ action: 'fetch', url: key.name, text: '' } as MsgBody);
			}
			return Response.json(json);
		} else {
			return new Response(null, { status: 405 });
		}
	},
} satisfies ExportedHandler<Env>;
