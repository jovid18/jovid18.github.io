---
title: SameSite로 막히지 않는 CSRF
description: SameSite=Lax가 막는 건 다른 사이트에서 오는 요청뿐이다. 같은 사이트의 다른 서브도메인에서 오는 요청을 Origin 헤더로 거른 show-gi의 방식을 정리한 기록.
publishedAt: 2026-10-29
domain: backend
project: show-gi
type: concept
topics:
  - csrf
  - cookie
  - auth
draft: true
---

CSRF는 브라우저가 쿠키를 알아서 실어 준다는 점을 노린다. 내가 show-gi에 로그인한 채로 공격자의 페이지를 열면, 그 페이지가 몰래 show-gi API로 요청을 보낸다. 브라우저는 그 요청에도 내 세션 쿠키를 실어 주니, 서버 입장에서는 내가 보낸 요청과 구별이 안 된다.

요즘 브라우저에서 이 공격의 대부분은 [앞 편](/blog/signed-session-cookie/)에서 세션 쿠키에 붙인 `SameSite=Lax`가 막는다. 그런데 "대부분"에서 빠지는 경우가 있었다.

### SameSite는 사이트를 본다

`SameSite`의 "사이트"는 흔히 생각하는 출처와 다르다.

|        | 무엇으로 정하나                         | `show-gi.com`과 `a.show-gi.com` | `localhost:5173`과 `localhost:3000` |
| ------ | --------------------------------------- | ------------------------------- | ----------------------------------- |
| 출처   | 스킴 + 호스트 + 포트                    | 다르다                          | 다르다                              |
| 사이트 | 스킴 + 등록 가능한 도메인               | 같다                            | 같다                                |

등록 가능한 도메인은 `show-gi.com`처럼 실제로 사서 등록하는 단위다. 그 아래 서브도메인은 전부 같은 사이트로 친다. 포트도 사이트를 가르지 않는다.

`SameSite=Lax`는 **다른 사이트**에서 보낸 POST나 `fetch`에 쿠키를 싣지 않는 속성이다. 같은 사이트에서 보낸 요청에는 쿠키가 그대로 실린다. 그러니 `a.show-gi.com`에 공격자 코드가 올라가면, 그 페이지에서 `show-gi.com/api/...`로 보내는 POST에는 피해자의 세션 쿠키가 실린다.

서브도메인을 공격자가 차지하는 건 생각보다 드물지 않다. 지워 두지 않은 DNS 레코드가 이미 해지한 외부 호스팅을 가리키고 있으면, 누군가 그 호스팅을 같은 이름으로 다시 만들어 서브도메인을 가져갈 수 있다.

### CORS는 요청을 막지 않는다

"다른 출처에서 오는 요청은 CORS가 막지 않나?" 싶지만, CORS가 막는 건 **응답을 읽는 것**이다. 요청을 보내는 것 자체는 막지 않는다.

`application/json` 같은 본문을 실은 `fetch`라면 브라우저가 먼저 OPTIONS로 허락을 묻는 preflight를 보내고, 서버가 허락하지 않으면 본 요청을 보내지 않는다. 하지만 HTML 폼으로 보낼 수 있는 형식, 즉 `application/x-www-form-urlencoded`나 `text/plain` 본문의 POST는 preflight 없이 바로 간다. 공격자는 응답을 못 읽어도 상관없다. 요청이 서버에 도착해서 상태가 바뀌면 그걸로 끝이다.

### Origin 헤더로 거른다

브라우저는 GET과 HEAD가 아닌 요청에 `Origin` 헤더를 붙인다. 요청을 보낸 페이지의 출처다. 페이지의 JavaScript가 이 헤더를 바꿀 수 없으니, 서버는 이걸 보고 요청이 어디서 왔는지 알 수 있다.

show-gi는 모든 API 앞에 미들웨어를 하나 끼웠다.

```go
func sameOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if u, err := url.Parse(origin); err != nil || u.Host == "" || u.Host != r.Host {
			writeJSON(w, http.StatusForbidden, ...)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

규칙은 네 줄이다.

- **GET·HEAD·OPTIONS는 통과한다.** 이 요청들은 상태를 바꾸지 않는다는 전제다. GET으로 무언가를 지우는 API가 있으면 이 검사는 의미가 없어진다
- **`Origin`이 다르면 403이다.** `a.show-gi.com`에서 온 POST는 여기서 걸린다. 포트만 다른 `localhost:3000`도 걸린다
- **`Origin`이 없으면 통과한다.** 브라우저는 POST에 늘 `Origin`을 붙이니, 이건 curl이나 부하 테스트 도구 같은 브라우저 밖의 호출이다. 그런 호출은 피해자의 쿠키를 실을 방법이 없다. 쿠키를 훔쳤다면 이미 CSRF가 아니라 다른 문제다
- **`Origin: null`은 거부한다.** 샌드박스 iframe이나 `file://`로 연 페이지처럼 출처를 밝힐 수 없는 곳에서 온 요청이 이 값을 단다. 정상 화면에서는 나올 일이 없다

### PUBLIC_ORIGIN이 아니라 Host와 비교한다

show-gi 서버에는 자기 주소를 적어 두는 `PUBLIC_ORIGIN` 설정이 있다. `Origin`을 그 값과 비교해도 될 것 같지만, 요청의 `Host` 헤더와 비교했다.

로컬 개발에서는 `PUBLIC_ORIGIN`을 비워 둔다. 브라우저는 Vite 개발 서버(`localhost:5173`)를 부르고, Vite가 API 요청을 Go 서버(`localhost:8080`)로 넘긴다. 이때 Vite가 `Host`를 바꾸지 않도록 설정해 두었기 때문에, Go 서버가 받는 `Host`는 브라우저가 부른 그대로 `localhost:5173`이다. 프로덕션도 앞단의 ALB와 Caddy가 `Host`를 그대로 넘긴다. 어느 환경에서든 "브라우저가 부른 주소"가 `Host`에 남아 있으니, 설정값 없이 같은 코드로 비교할 수 있다.

### WebSocket은 라이브러리가 본다

show-gi에서 대국은 WebSocket으로 진행된다. WebSocket 연결은 GET 요청으로 시작하니 위 미들웨어를 그냥 통과한다. 연결이 열릴 때 세션 쿠키를 읽어 판의 주인을 정하기 때문에, 여기도 다른 출처에서 연결을 열 수 있으면 곤란하다.

이건 쓰고 있는 `github.com/coder/websocket`이 이미 막고 있다. 이 라이브러리의 `Accept`는 따로 옵션을 주지 않으면 `Origin`의 호스트가 요청의 `Host`와 다를 때 연결을 거부한다. 미들웨어와 같은 규칙이다.

### 다른 방법들

CSRF를 막는 방법은 이것 말고도 있다.

| 방법             | 방식                                                         |
| ---------------- | ------------------------------------------------------------ |
| CSRF 토큰        | 서버가 발급한 랜덤 값을 폼이나 헤더에 실어 보내게 하고 맞춰 본다 |
| `Sec-Fetch-Site` | 브라우저가 붙이는 `same-origin`·`same-site`·`cross-site` 값을 본다 |
| `Origin` 검사    | 요청의 `Origin`이 자기 출처인지 본다                         |

CSRF 토큰은 가장 오래된 방법이지만, 서버가 토큰을 발급하고 화면이 모든 요청에 실어야 해서 손댈 곳이 많다. `Origin` 검사는 서버에 미들웨어 하나만 끼우면 되고, 화면 코드는 건드릴 필요가 없다. `SameSite=Lax`가 다른 사이트를 막고, `Origin` 검사가 같은 사이트의 다른 출처를 막는 식으로 둘이 나눠 맡는다.

[마지막 편](/blog/www-redirect-uri-mismatch/)에서는 이번 점검 중에 발견한 버그, `www.show-gi.com`에서만 로그인이 안 되던 이유를 다룬다.
