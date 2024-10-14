# Cloudflare Blog Summarizer

This project is a Cloudflare Worker that summarizes Cloudflare blog posts and translates them into Korean.

## Architecture

The project consists of two main parts:

1. **Blog Post Fetcher:** This worker fetches a list of Cloudflare blog posts and stores them in a Workers KV namespace.
2. **Blog Post Summarizer:** This worker processes the list of blog posts, summarizes each post using the `@cf/meta/llama-3.2-3b-instruct` AI model, translates the summary into Korean using the `@cf/meta/m2m100-1.2b` AI model, and stores the translated summary in another Workers KV namespace.

The two workers communicate with each other through a queue. The Blog Post Fetcher worker sends messages to the queue containing the URL of each blog post. The Blog Post Summarizer worker receives these messages and processes the corresponding blog posts.

## How it Works

1. The Blog Post Fetcher worker fetches a list of Cloudflare blog posts from the Cloudflare blog website.
2. For each blog post, the worker extracts the post's URL and stores it in the `cf-blog-list` KV namespace.
3. The worker sends a message to the `cfblog-list-queue` queue containing the URL of the blog post.
4. The Blog Post Summarizer worker receives the message from the queue.
5. The worker fetches the content of the blog post from the provided URL.
6. The worker uses the `@cf/meta/llama-3.2-3b-instruct` AI model to summarize the blog post.
7. The worker uses the `@cf/meta/m2m100-1.2b` AI model to translate the summary into Korean.
8. The worker stores the translated summary in the `cfblog-summary` KV namespace, using the blog post's URL as the key.

## Usage

To use the Cloudflare Blog Summarizer, you can make a GET request to the deployed worker's endpoint. The request should include two query parameters:

- `start`: The starting page number of the Cloudflare blog to fetch posts from.
- `end`: The ending page number of the Cloudflare blog to fetch posts from.

For example, to fetch and summarize blog posts from pages 1 to 5, you would make the following request:

```bash
https://?start=1&end=5

```

The worker will return a JSON response containing the URLs of the processed blog posts and their corresponding translated summaries.

## Requirements

- A Cloudflare account
- A Cloudflare Workers subscription
- A Workers KV namespace
- An API token with access to the Cloudflare AI API

## Deployment

1. Create a new Cloudflare Worker.
2. Copy the code from `index.ts` to your worker.
3. Replace the placeholder values in the code with your own values.
4. Deploy your worker.

## Contributing

Contributions are welcome! Please open an issue or pull request if you have any suggestions or improvements.
