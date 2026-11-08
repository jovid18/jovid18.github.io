---
title: www에서만 구글 로그인이 안 되던 이유
description: Host에서 redirect URI를 만들던 서버가 www에서 등록되지 않은 주소를 보내고 있었다. PUBLIC_ORIGIN 고정만으로는 부족해 ALB에서 www를 apex로 보낸 과정을 정리한 기록.
publishedAt: 2026-10-29
domain: backend
project: show-gi
type: troubleshooting
topics:
  - oauth2
  - aws-alb
  - auth
draft: true
---

로그인 보안 점검을 하다가 보안과는 상관없는 버그를 하나 찾았다. `https://show-gi.com`에서는 구글 로그인이 잘 되는데, `https://www.show-gi.com`에서는 되지 않고 있었다.

### redirect URI는 한 글자도 달라선 안 된다

구글 로그인 화면으로 보낼 때 `redirect_uri`에 "로그인이 끝나면 돌려보낼 주소"를 싣는다. 구글은 이 값을 구글 클라우드 콘솔에 미리 등록해 둔 주소와 **정확히** 비교한다. 스킴, 호스트, 포트, 경로 중 하나라도 다르면 로그인 화면을 띄우지 않고 `redirect_uri_mismatch` 오류를 낸다.

공격자가 `redirect_uri`를 자기 서버로 바꿔서 code를 빼돌리지 못하게 하려는 장치라, 비슷한 주소를 봐주는 일이 없다.

show-gi가 등록해 둔 주소는 둘이었다.

```text
https://show-gi.com/api/auth/google/callback
http://localhost:5173/api/auth/google/callback
```

`www`는 없다.

### 서버는 Host에서 주소를 만들고 있었다

show-gi 서버는 `redirect_uri`를 요청을 보고 만든다.

```go
func (h *authHandler) origin(r *http.Request) string {
	if h.publicOrigin != "" {
		return strings.TrimSuffix(h.publicOrigin, "/")
	}
	host := r.Host
	scheme := "https"
	if isLocalHost(host) {
		scheme = "http"
	}
	return scheme + "://" + host
}
```

`PUBLIC_ORIGIN` 설정이 있으면 그 값을 쓰고, 없으면 요청의 `Host`로 주소를 되짚는다. 프로덕션에는 `PUBLIC_ORIGIN`이 비어 있었다. 그리고 `www.show-gi.com`은 ALB가 apex와 똑같이 받아서 서버로 넘기고 있었다.

그러니 www에서 로그인을 누르면 `Host`가 `www.show-gi.com`이고, 서버는 `https://www.show-gi.com/api/auth/google/callback`을 `redirect_uri`로 실어 보낸다. 등록되지 않은 주소라 구글이 거부한다.

### 왜 Host로 정했나

처음 로그인을 붙일 때 `PUBLIC_ORIGIN`을 비워 두는 걸 기본으로 했던 데는 이유가 있었다.

스킴을 정하는 흔한 방법은 `X-Forwarded-Proto` 헤더를 보는 것이다. 앞단 프록시가 "브라우저는 원래 https로 왔다"고 알려 주는 헤더다. 그런데 show-gi 앞단은 ALB 뒤에 Caddy가 한 겹 더 있는 구조다. Caddy는 앞단을 믿도록 따로 설정하지 않으면 이 헤더를 자기가 받은 연결 기준인 `http`로 덮어쓴다. 이 헤더를 믿었다면 프로덕션에서 `http://show-gi.com/...`이 나가 구글이 거부했을 것이다.

그래서 스킴을 헤더 대신 호스트로 정했다. 배포된 곳은 전부 HTTPS이고 평문은 로컬뿐이라, "localhost면 http, 아니면 https" 한 줄이면 됐다. 이렇게 하면 로컬과 프로덕션이 설정값 없이 같은 코드로 돌아간다.

비슷한 일은 로컬에서도 한 번 있었다. 처음 로그인을 붙였을 때 구글이 `http://localhost:8080/...`을 거부했다. 브라우저는 Vite 개발 서버(`5173`)를 부르는데, Vite 프록시가 기본값으로 `Host`를 Go 서버 주소(`8080`)로 바꿔서 넘기고 있었다. Vite 설정에서 `changeOrigin: false`로 `Host`를 보존하게 해서 해결했다.

`Host`에서 주소를 되짚는 방식은 "브라우저가 부른 주소가 곧 등록된 주소"일 때만 맞다. www는 그 전제를 깨는 첫 번째 주소였다.

### PUBLIC_ORIGIN만 고정하면

가장 먼저 떠오르는 해결은 프로덕션의 `PUBLIC_ORIGIN`을 `https://show-gi.com`으로 고정하는 것이다. 그러면 www에서 시작해도 `redirect_uri`는 apex로 나가고, 구글은 거부하지 않는다.

그런데 이것만으로는 로그인이 되지 않는다.

1. 사용자가 `www.show-gi.com`에서 로그인을 누른다
2. 서버가 `state`와 PKCE `code_verifier` 쿠키를 굽는다. 이 쿠키는 **`www.show-gi.com`에** 묶인다
3. 구글 로그인이 끝나면 구글은 `redirect_uri`대로 **`show-gi.com`의** 콜백으로 돌려보낸다
4. 브라우저는 apex로 가는 요청에 www의 쿠키를 싣지 않는다
5. 서버는 `state` 쿠키가 없으니 우리가 시작하지 않은 콜백으로 보고 버린다

`Domain=show-gi.com`을 붙여 쿠키를 두 호스트가 같이 쓰게 하는 방법도 있지만, [세션 쿠키 편](/blog/signed-session-cookie/)에서 `__Host-` 접두사를 붙인 이유가 바로 `Domain` 속성을 금지하려는 것이었다. 쓸 수 없는 길이다.

`www` 콜백 주소를 구글에 하나 더 등록하는 방법도 있다. 로그인 자체는 되지만, 세션 쿠키도 호스트마다 따로라서 apex에서 로그인한 사람이 www로 오면 로그아웃된 상태로 보인다. 같은 사이트가 두 개의 로그인을 갖는 셈이다.

### 주소를 하나로 모은다

결국 www를 apex로 보내는 수밖에 없다. 브라우저가 www에 머무는 일이 없으면 쿠키가 갈릴 일도 없다.

ALB의 HTTPS 리스너에 규칙을 하나 추가했다. `Host`가 www면 서버까지 가지 않고 ALB가 바로 apex로 301 리디렉트한다. 경로와 쿼리는 그대로 유지한다.

```hcl
resource "aws_lb_listener_rule" "www_to_apex" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

  condition {
    host_header {
      values = ["www.${var.domain}"]
    }
  }

  action {
    type = "redirect"
    redirect {
      host        = var.domain
      port        = "#{port}"
      protocol    = "#{protocol}"
      path        = "/#{path}"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }
}
```

그리고 `PUBLIC_ORIGIN`도 ECS 태스크 환경 변수로 apex에 고정했다. www가 서버에 닿지 않으니 없어도 동작은 같지만, `redirect_uri`의 정본이 어디인지 설정에 적어 두는 쪽이 다음 사람이 덜 헤맨다. 로컬에서는 여전히 비워 두고 `Host`에서 되짚는다.

```hcl
{ name = "PUBLIC_ORIGIN", value = "https://${var.domain}" },
```

### 정리

- `redirect_uri`는 등록한 주소와 정확히 같아야 한다. 요청에서 주소를 되짚는 코드는 사용자가 부를 수 있는 호스트가 하나 늘 때마다 깨질 수 있다
- 로그인 흐름의 쿠키는 시작한 호스트와 돌아오는 호스트가 같아야 실린다. `redirect_uri`만 맞춰서는 부족하다
- 같은 서비스로 들어오는 주소가 여럿이면 앞단에서 하나로 모으는 게 가장 단순하다

이걸로 show-gi에 구글 로그인을 붙이며 정리한 연작을 마친다. [첫 편](/blog/oidc-vs-oauth2/)에서 "로그인한 사람이 누구인가"를 묻는 데서 시작해서 code, 토큰, 쿠키, 요청 출처, 그리고 주소 하나까지 왔다. 소셜 로그인 버튼 하나 뒤에 생각보다 많은 것이 걸려 있었다.
