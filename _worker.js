// ================= 基础配置 =================
let hub_host = 'registry-1.docker.io'
const auth_url = 'https://auth.docker.io'
let workers_url = 'https://docker.funnymp.top'

// ================= 路由规则 =================
function routeByHosts(host) {
	const routes = {
		'quay': 'quay.io',
		'gcr': 'gcr.io',
		'k8s-gcr': 'k8s.gcr.io',
		'k8s': 'registry.k8s.io',
		'ghcr': 'ghcr.io',
		'nvcr': 'nvcr.io',
	}
	if (host in routes) return [routes[host], false]
	return [hub_host, true]
}

// ================= 工具函数 =================
function isUUID(str) {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
}

function nginxPage() {
	return `
<!DOCTYPE html>
<html>
<head><title>Welcome to nginx!</title></head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed.</p>
</body>
</html>`
}

// ================= 主入口 =================
export default {
	async fetch(request) {
		const url = new URL(request.url)
		workers_url = `https://${url.hostname}`
		const pathname = url.pathname
		const ua = request.headers.get('User-Agent') || ''

		// ====== ① Docker login 必须先命中这里 ======
		if (pathname === '/v2' || pathname === '/v2/') {
			return new Response(null, {
				status: 401,
				headers: {
					'Www-Authenticate':
						`Bearer realm="${workers_url}/token",service="registry.docker.io"`,
					'Content-Type': 'application/json'
				}
			})
		}

		// ====== ② token 请求（必须透传 Authorization） ======
		if (pathname.startsWith('/token')) {
			const headers = new Headers()
			headers.set('Host', 'auth.docker.io')
			headers.set('User-Agent', ua)
			headers.set('Accept', request.headers.get('Accept') || '*/*')

			if (request.headers.has('Authorization')) {
				headers.set('Authorization', request.headers.get('Authorization'))
			}

			return fetch(auth_url + pathname + url.search, {
				method: request.method,
				headers
			})
		}

		// ====== ③ 解析目标仓库 ======
		const hostTop = url.hostname.split('.')[0]
		const [targetHost] = routeByHosts(hostTop)
		hub_host = targetHost

		// ====== ④ library 补全 ======
		if (
			/^\/v2\/[^/]+\/[^/]+\/manifests/.test(pathname) &&
			!pathname.startsWith('/v2/library/')
		) {
			url.pathname = pathname.replace('/v2/', '/v2/library/')
		}

		// ====== ⑤ 构造代理请求 ======
		url.hostname = hub_host

		const headers = new Headers()
		headers.set('Host', hub_host)
		headers.set('User-Agent', ua)
		headers.set('Accept', request.headers.get('Accept') || '*/*')

		if (request.headers.has('Authorization')) {
			headers.set('Authorization', request.headers.get('Authorization'))
		}

		const resp = await fetch(url.toString(), {
			method: request.method,
			headers,
			body: request.method === 'GET' || request.method === 'HEAD'
				? null
				: request.body,
			redirect: 'follow'
		})

		// ====== ⑥ 重写认证头 ======
		const newHeaders = new Headers(resp.headers)
		if (newHeaders.has('Www-Authenticate')) {
			newHeaders.set(
				'Www-Authenticate',
				newHeaders.get('Www-Authenticate')
					.replace(/https:\/\/auth\.docker\.io/g, workers_url)
			)
		}

		return new Response(resp.body, {
			status: resp.status,
			headers: newHeaders
		})
	}
}
