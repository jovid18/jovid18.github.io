---
title: 세션을 서명 쿠키로 들고 다니기
description: show-gi가 세션을 DB 대신 HMAC 서명 쿠키에 담은 이유와 그 대가, 그리고 HttpOnly·Secure·SameSite·__Host- 접두사로 그 쿠키를 지킨 방법을 정리한 기록.
publishedAt: 2026-10-29
domain: backend
project: show-gi
type: design
topics:
  - cookie
  - hmac
  - auth
draft: true
---

구글 로그인이 끝나면 show-gi는 "이 브라우저는 user 7번이다"를 어딘가에 기억해 둬야 한다. 보통은 세션 테이블에 행을 하나 만들고, 브라우저에는 그 행을 가리키는 랜덤 ID만 쿠키로 준다.

show-gi는 테이블을 만들지 않았다. 쿠키 안에 사용자 정보를 그대로 넣고 서명만 붙였다.

### 서명 쿠키의 생김새

쿠키에 담는 건 세 가지다.

```go
type Session struct {
	UserID  int64  `json:"uid"`
	Name    string `json:"name"`
	Expires int64  `json:"exp"` // Unix 초
}
```

이걸 JSON으로 만들어 base64로 감싸고, 서버만 아는 `SESSION_SECRET`으로 HMAC-SHA256 서명을 계산해 점으로 이어 붙인다.

```text
eyJ1aWQiOjcsIm5hbWUiOiLtmY3quLjrj5kiLCJleHAiOjE3OTU3NzI4MDB9.5dfQnNG02UFdrQCx4KgUOMc-gqm4AWwpwcQBtF1z5xo

payload → {"uid":7,"name":"홍길동","exp":1795772800}
서명    → HMAC-SHA256(SESSION_SECRET, payload)
```

payload는 base64일 뿐이라 누구나 풀어서 읽을 수 있다. 대신 고칠 수는 없다. `uid`를 7에서 1로 바꾸면 서명이 맞지 않고, 맞는 서명을 다시 만들려면 `SESSION_SECRET`이 있어야 한다. JWT와 같은 원리인데, 필요한 게 이것뿐이라 JWT 형식까지 쓰지는 않았다.

읽을 때는 순서가 중요하다.

```go
func (c *Codec) Decode(value string, now time.Time) (Session, error) {
	payload, sig, ok := cut(value)
	if !ok {
		return Session{}, ErrNoSession
	}
	// 서명이 확인되기 전의 payload는 공격자가 쓴 문자열이다
	if !hmac.Equal([]byte(sig), []byte(c.sign(payload))) {
		return Session{}, ErrNoSession
	}
	// 여기서부터 base64·JSON을 푼다
	// ...
	if s.UserID <= 0 || now.Unix() >= s.Expires {
		return Session{}, ErrNoSession
	}
	return s, nil
}
```

- **서명을 먼저 본다.** 서명이 맞기 전의 payload는 아무나 쓴 문자열이라, JSON 파서에 넣는 것조차 공격자가 고른 입력을 먹이는 일이다
- **`hmac.Equal`로 비교한다.** `==`는 앞에서부터 다른 글자를 만나는 순간 멈춰서, 응답 시간 차이로 서명을 한 글자씩 맞춰 볼 여지를 준다. `hmac.Equal`은 항상 끝까지 비교한다
- **실패 이유를 구별하지 않는다.** 쿠키가 없든, 서명이 틀렸든, 만료됐든 모두 `ErrNoSession`이다. 부르는 쪽이 할 일은 어느 경우든 같고, 구별해서 알려 주면 서명을 위조하려는 쪽에 힌트가 된다

`Name`까지 넣은 건 화면 오른쪽 위에 이름 한 줄을 그리려고 요청마다 `users` 테이블을 읽지 않기 위해서다.

### 테이블을 안 만든 대가

세션 테이블이 없으면 로그인할 때마다 DB에 쓸 일이 없고, 마이그레이션도 하나 줄어든다. 대신 치르는 대가가 하나 있고, 꽤 크다.

**서버가 발급한 세션을 끊을 수 없다.** 세션 테이블이 있으면 행을 지우는 순간 그 로그인이 끝난다. 서명 쿠키는 서버에 짝이 없어서, 서명이 맞고 만료되지 않았으면 언제든 통과한다.

- 로그아웃은 브라우저의 쿠키를 지우는 것뿐이다. 그 전에 누가 쿠키 값을 복사해 갔다면 그 복사본은 계속 산다
- 특정 사용자만 강제로 로그아웃시킬 방법이 없다. 할 수 있는 건 `SESSION_SECRET`을 바꿔서 **모든** 사람을 로그아웃시키는 것뿐이다
- 그래서 TTL 30일이 곧 "기기를 잃어버렸을 때 남의 손에 로그인이 살아 있는 시간"이다

show-gi에서 세션으로 할 수 있는 건 내 대국 기록과 실력 프로필을 보는 정도다. 결제나 개인정보가 걸린 서비스였다면 이 대가를 받아들이지 않았을 것이다. 이번 보안 점검에서도 세션 철회는 넣지 않고 이 한계를 그대로 두었다.

### 키가 짧으면

모든 게 `SESSION_SECRET` 하나에 걸려 있다. 키가 짧으면 공격자는 쿠키 하나만 손에 넣고, 자기 컴퓨터에서 키 후보를 하나씩 넣어 서명을 맞춰 볼 수 있다. 서버에 요청을 보낼 필요도 없는 오프라인 대입이라 막을 방법이 없다.

그래서 서버가 뜰 때 키가 32글자보다 짧으면 경고를 남기게 했다. `openssl rand -base64 32`로 만든 키라면 32글자를 훌쩍 넘는다.

```go
if len(os.Getenv("SESSION_SECRET")) < minSessionSecret {
	slog.Warn("SESSION_SECRET is short", "min", minSessionSecret, "hint", "openssl rand -base64 32")
}
```

로그인을 아예 꺼 버리지 않고 경고만 하는 건, 이미 돌고 있는 배포가 재시작 한 번에 로그인 없는 서비스가 되는 걸 피하려는 것이다.

### 쿠키에 붙인 속성

세션 쿠키는 이렇게 굽는다.

```go
http.SetCookie(w, &http.Cookie{
	Name:     h.cookieName(r, sessionCookie), // HTTPS면 "__Host-showgi_session"
	Value:    value,
	Path:     "/",
	MaxAge:   int(auth.SessionTTL.Seconds()),
	HttpOnly: true,
	Secure:   secure,
	SameSite: http.SameSiteLaxMode,
})
```

| 속성          | 막는 것                                                        |
| ------------- | -------------------------------------------------------------- |
| `HttpOnly`    | 페이지의 JavaScript가 쿠키를 읽지 못한다. XSS가 나도 값을 들고 나갈 수 없다 |
| `Secure`      | HTTPS 연결에만 실린다. 평문 HTTP로 새지 않는다                  |
| `SameSite=Lax` | 다른 사이트에서 보내는 POST나 `fetch`에는 쿠키가 실리지 않는다 |

`SameSite`를 더 엄격한 `Strict`로 두지 않은 데는 이유가 있다. 같은 속성으로 굽는 `state`와 PKCE `code_verifier` 쿠키는 구글 로그인 화면에서 돌아오는 콜백에 실려야 한다. 이 콜백은 `accounts.google.com`이 보내는 다른 사이트발 이동이라, `Strict`면 쿠키가 실리지 않아 로그인이 매번 실패한다. `Lax`는 이렇게 주소창이 바뀌는 GET 이동에는 쿠키를 실어 준다.

`Lax`가 막아 주지 못하는 CSRF도 있는데, 이건 다음 편에서 따로 다룬다.

### 쿠키는 남이 심을 수도 있다

여기까지는 쿠키를 **훔치거나 고치는** 걸 막는 얘기였다. 이번에 RFC 9700과 대조하면서 눈에 띈 건 반대 방향, 남이 쿠키를 **심는** 공격이었다.

쿠키는 도메인 단위로 묶인다. `a.show-gi.com`에서 돌아가는 페이지는 `Domain=show-gi.com`을 붙여 쿠키를 구울 수 있고, 브라우저는 그 쿠키를 `show-gi.com`에도 실어 보낸다. 서버가 받는 `Cookie` 헤더에는 이름과 값만 있어서, 그 쿠키를 누가 구웠는지 알 방법이 없다.

show-gi.com 아래의 다른 서브도메인 하나가 남의 손에 들어가면 이런 일이 가능하다. 지워 두지 않은 DNS 레코드가 남이 가져갈 수 있는 외부 서비스를 가리키고 있는 경우가 흔한 예다.

- **세션 쿠키를 심는다.** 공격자 계정의 세션 쿠키를 피해자 브라우저에 넣으면, 피해자는 공격자 계정으로 로그인된 채 쇼기를 둔다. [state와 PKCE 편](/blog/state-vs-pkce/)의 로그인 CSRF와 같은 결과를, code 없이 바로 만든다
- **`state`와 `code_verifier` 쿠키를 심는다.** 공격자가 자기 로그인에서 쓴 `state`와 `code_verifier`를 피해자 브라우저에 넣고, 자기 code가 든 콜백 주소를 열게 하면 두 검사가 모두 통과한다. 피해자 브라우저의 쿠키가 전부 공격자 것이기 때문이다

이렇게 남의 쿠키를 밀어 넣는 걸 cookie tossing이라고 부른다.

### __Host- 접두사

쿠키 이름이 `__Host-`로 시작하면 브라우저가 그 쿠키에 세 가지 조건을 강제한다.

- `Secure`가 붙어 있어야 한다
- `Path=/`여야 한다
- `Domain` 속성이 없어야 한다

`Domain`이 없는 쿠키는 그 쿠키를 구운 호스트에만 묶인다. 그러니 `__Host-showgi_session`이라는 이름의 쿠키는 `show-gi.com` 자신만 구울 수 있다. 서브도메인이 `Domain=show-gi.com`을 붙여 같은 이름으로 구우려 하면 브라우저가 거부한다.

서버는 접두사가 붙은 이름만 읽는다. 서브도메인이 접두사 없는 `showgi_session`을 심어 두더라도 서버는 그 쿠키를 보지 않는다.

### 로컬에서는 붙이지 않는다

`__Host-`는 `Secure`를 요구하는데, 로컬 개발 서버는 평문 HTTP다. 그대로 붙이면 브라우저가 쿠키를 거부해서 로컬 로그인이 아무 경고 없이 실패한다.

그래서 접두사를 붙일지는 `Secure`를 붙일지와 같은 함수로 정한다. 굽는 곳과 읽는 곳이 모두 이 함수를 거친다.

```go
// Secure가 붙는 쿠키에만 접두사가 붙는다
func (h *authHandler) cookieName(r *http.Request, name string) string {
	if h.secure(r) {
		return hostPrefix + name
	}
	return name
}
```

두 판단이 따로 놀면 로컬에서는 접두사만 붙어 로그인이 깨지거나, 프로덕션에서는 접두사가 빠져 cookie tossing이 다시 열린다.

### 이름을 바꾼 대가

쿠키 이름이 바뀌었으니 배포하는 순간 로그인한 모든 사람이 한 번 로그아웃된다. 옛 이름도 한동안 읽어 주는 이행 기간을 두면 이걸 피할 수 있지만 두지 않았다. 접두사 없는 쿠키는 남이 심었을 수 있는 쿠키라서, 그걸 읽어 주는 동안은 막으려던 구멍이 그대로 열려 있기 때문이다. 한 번 다시 로그인하는 비용이 더 싸다.

[다음 편](/blog/csrf-beyond-samesite/)에서는 `SameSite=Lax`로 막히지 않는 CSRF와, 그걸 막으려고 넣은 `Origin` 검사를 다룬다.
