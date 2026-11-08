---
title: state와 PKCE는 각각 무엇을 막나
description: Authorization Code 흐름에서 state가 막는 로그인 CSRF와, state로는 막지 못해 PKCE가 필요한 code 주입을 show-gi 로그인 코드로 정리한 기록.
publishedAt: 2026-10-29
domain: backend
project: show-gi
type: concept
topics:
  - oauth2
  - pkce
  - csrf
  - auth
draft: true
---

[앞 글](/blog/oidc-vs-oauth2/)에서 Authorization Code 흐름은 code를 한 번 거쳐 토큰으로 바꾼다고 정리했다. 주소창을 지나가는 건 그 자체로는 쓸모없는 code뿐이고, 진짜 토큰은 서버와 구글이 직접 주고받는다.

그런데 code가 쓸모없는 건 "다른 사람 손에 들어갔을 때"의 얘기고, 공격자 입장에서는 code를 엉뚱한 브라우저에 밀어 넣는 것만으로도 할 수 있는 일이 있다. show-gi 로그인은 처음에 `state` 하나로 이걸 막고 있었는데, OAuth 보안 권고인 RFC 9700과 대조해 보니 `state`가 막지 못하는 구멍이 하나 있었다. 그래서 PKCE를 붙였다.

두 장치가 막는 공격은 방향이 정반대라서, 하나씩 따로 보는 게 이해하기 쉽다.

### show-gi 로그인 흐름

show-gi는 브라우저가 아니라 Go 서버가 code를 토큰으로 바꾼다. client secret은 서버에만 있다.

1. 사용자가 `ログイン`을 누르면 서버의 `/api/auth/google/start`로 간다
2. 서버가 구글 로그인 화면 주소를 만들어 리디렉트한다
3. 사용자가 구글에서 로그인하면 구글이 `/api/auth/google/callback?code=...&state=...`로 돌려보낸다
4. 서버가 code와 client secret을 구글 토큰 엔드포인트에 보내 ID Token을 받는다
5. ID Token의 `sub`로 회원을 찾고, 세션 쿠키를 굽는다

공격자가 노리는 건 3번이다. 콜백은 브라우저 주소창으로 들어오는 평범한 GET 요청이라, 누구든 아무 code나 실어서 부를 수 있다.

### state가 막는 것: 로그인 CSRF

첫 번째 공격은 **피해자의 브라우저에 공격자의 code를 넣는 것**이다.

1. 공격자가 자기 구글 계정으로 show-gi 로그인을 시작한다
2. 구글이 공격자를 콜백으로 돌려보내려는 순간, 공격자는 그 주소만 복사하고 멈춘다. 주소에는 공격자 계정의 code가 들어 있다
3. 공격자가 이 주소를 피해자에게 열게 만든다. 링크를 보내도 되고, 공격자 사이트에 숨긴 이미지로 넣어도 된다
4. 피해자의 브라우저가 콜백을 부르고, 서버는 code를 교환해 **공격자 계정**의 세션을 피해자 브라우저에 굽는다

피해자는 자기가 로그인한 줄 알고 그대로 쇼기를 둔다. 그 대국 기록과 실력 프로필은 전부 공격자 계정에 쌓이고, 공격자는 자기 계정으로 들어가 그걸 본다. 비밀번호를 훔친 게 아니라 **피해자를 내 계정에 앉힌** 공격이다.

`state`는 "이 콜백은 이 브라우저가 시작한 로그인의 것이다"를 확인한다. 로그인을 시작할 때 랜덤 값을 만들어 쿠키에 굽고, 같은 값을 구글로 가는 주소에도 싣는다. 구글은 그 값을 콜백에 그대로 돌려준다.

```go
// start
state, err := randomState() // 32바이트 난수
http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: state, HttpOnly: true, ...})
http.Redirect(w, r, h.google.AuthURL(h.redirectURI(r), state, verifier), http.StatusFound)

// callback
state, err := r.Cookie(stateCookie)
if err != nil || state.Value == "" || state.Value != q.Get("state") {
	// 우리가 시작하지 않은 콜백이다
	http.Redirect(w, r, "/", http.StatusFound)
	return
}
```

공격자가 피해자에게 연 주소에는 **공격자 브라우저의** `state`가 들어 있다. 피해자 브라우저의 쿠키에는 그 값이 없으니 서버는 콜백을 버린다.

### state가 막지 못하는 것: code 주입

두 번째 공격은 방향이 반대다. **공격자의 브라우저에 피해자의 code를 넣는다.**

code는 주소창을 지나가기 때문에 생각보다 여러 곳에 남는다. 브라우저 방문 기록, 프록시나 서버의 접근 로그, 콜백 페이지가 외부 리소스를 부를 때 붙는 `Referer` 헤더, 주소를 읽을 수 있는 브라우저 확장 같은 곳이다. 공격자가 어떻게든 피해자의 code 하나를 손에 넣었다고 해 보자.

1. 공격자가 **자기 브라우저**에서 show-gi 로그인을 시작한다. 공격자 브라우저에 공격자의 `state` 쿠키가 구워진다
2. 구글에서 돌아오는 주소의 code를 **피해자의 code로 바꿔치기**해서 콜백을 부른다
3. `state`는 공격자 쿠키와 공격자 주소에서 왔으니 서로 맞는다. 통과한다
4. 서버가 피해자의 code에 client secret을 붙여 교환한다. 구글은 정상적인 요청으로 보고 **피해자의** ID Token을 준다
5. 공격자 브라우저에 피해자 계정의 세션이 구워진다

`state`는 "콜백이 그 브라우저가 시작한 로그인의 것인가"만 본다. 공격자는 자기가 시작한 로그인에 남의 code만 끼워 넣었으니 `state` 입장에서는 아무 문제가 없다.

client secret도 도움이 안 된다. secret은 "이 교환을 요청한 게 show-gi 서버인가"를 증명하는데, 실제로 교환을 요청한 건 show-gi 서버가 맞다. 공격자는 secret을 알 필요 없이 서버가 대신 교환하게 만들었다. secret이 있는 서버 앱이라도 이 공격에는 똑같이 열려 있다.

### PKCE: code를 받아 낸 브라우저만 쓸 수 있게

빠진 건 "**이 code를 받아 낸 그 로그인**에서 온 교환인가"를 확인하는 장치다. PKCE(Proof Key for Code Exchange, RFC 7636)가 그 일을 한다.

1. 로그인을 시작할 때 랜덤 문자열 `code_verifier`를 만들고, SHA-256으로 해시한 `code_challenge`를 계산한다
2. 구글로 가는 주소에는 `code_challenge`만 싣는다. 구글은 이 값을 앞으로 발급할 code와 묶어 둔다
3. code를 교환할 때 원본 `code_verifier`를 같이 보낸다
4. 구글은 `code_verifier`를 해시해서 묶어 둔 `code_challenge`와 같을 때만 토큰을 준다

show-gi에서는 `state`와 똑같이 난수를 하나 더 만들어 쿠키에 둔다.

```go
// AuthURL — 주소에는 해시만 나간다
q := url.Values{
	// ...
	"state":                 {state},
	"code_challenge":        {challenge(verifier)},
	"code_challenge_method": {"S256"},
}

func challenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// Exchange — 원문은 교환 때 서버에서 구글로 직접 간다
form := url.Values{
	"code":          {code},
	"client_secret": {g.clientSecret},
	// ...
	"code_verifier": {verifier},
}
```

code 주입을 다시 따라가 보면, 피해자의 code는 **피해자 브라우저의** `code_verifier`에서 나온 `code_challenge`와 묶여 있다. 공격자 브라우저의 쿠키에 있는 건 공격자의 `code_verifier`다. 서버가 그걸 보내면 해시가 맞지 않아 구글이 교환을 거부한다. 피해자의 `code_verifier`는 피해자 브라우저의 HttpOnly 쿠키와, 서버에서 구글로 가는 TLS 요청에만 있었으니 공격자가 손에 넣을 길이 없다.

콜백에 `code_verifier` 쿠키가 아예 없으면 구글에 묻지도 않고 돌려보낸다. `state`와 같이 굽는 쿠키라, 한쪽만 없다는 건 배포 직전에 시작한 로그인 정도밖에 없다.

```go
verifier, err := r.Cookie(verifierCookie)
if err != nil || verifier.Value == "" {
	log.Print("auth: no PKCE verifier, ignoring callback")
	http.Redirect(w, r, "/", http.StatusFound)
	return
}
```

`code_challenge_method`는 `S256`을 쓴다. `plain`도 있지만 challenge와 verifier가 똑같아서, 주소에 실린 challenge를 본 순간 verifier도 알게 된다.

### PKCE의 원래 목적: code 가로채기

사실 PKCE는 code 주입보다 모바일 앱 때문에 먼저 나왔다.

모바일 앱은 secret을 숨길 수 없다. 앱 안에 넣어 배포하면 디컴파일로 꺼낼 수 있기 때문이다. 게다가 구글이 `myapp://callback?code=...` 같은 커스텀 스킴으로 앱을 깨워 code를 넘기는데, 악성 앱이 같은 스킴을 등록해 두면 code를 대신 받을 수 있다. 이 경우 공격자는 code를 남의 브라우저에 넣을 필요도 없이, 공개된 secret과 함께 직접 교환해 버린다.

PKCE를 쓰면 `code_verifier`는 로그인을 시작한 정상 앱의 메모리에만 있으니, code를 가로챈 악성 앱은 교환을 할 수 없다. 이렇게 secret이 없는 클라이언트를 위해 나온 장치였지만, 같은 원리로 code 주입까지 막는다는 게 알려지면서 RFC 9700과 OAuth 2.1 초안은 secret이 있는 서버 앱에도 PKCE를 쓰라고 권한다.

### 정리

| 공격          | 무엇을 어디에 넣나                | `state` | PKCE |
| ------------- | --------------------------------- | ------- | ---- |
| 로그인 CSRF   | 공격자의 code를 피해자 브라우저에 | 막는다  | 막는다 |
| code 주입     | 피해자의 code를 공격자 브라우저에 | 못 막는다 | 막는다 |
| code 가로채기 | 가로챈 code를 공격자가 직접 교환  | 못 막는다 | 막는다 |

`state`는 "이 콜백은 이 브라우저가 시작한 것인가"를, PKCE는 "이 code는 이 브라우저가 받아 낸 것인가"를 확인한다.

표를 보면 PKCE가 로그인 CSRF까지 막는다. 공격자의 code는 공격자의 `code_verifier`에 묶여 있어서, 피해자 브라우저의 `code_verifier`로는 교환이 되지 않기 때문이다. 그래서 RFC 9700은 인가 서버가 PKCE를 지원한다는 게 확실하면 CSRF 방어를 PKCE에 맡겨도 된다고 한다. show-gi는 이미 있던 `state`를 그대로 두었다. 우리가 시작하지 않은 콜백을 구글에 묻기 전에 서버 안에서 걸러 낼 수 있다는 장점도 있다.

남은 걱정이 하나 있다. `state`도 `code_verifier`도 결국 쿠키에 들어 있다. 누군가 이 쿠키를 피해자 브라우저에 미리 심어 둘 수 있다면 두 장치가 모두 흔들린다. show-gi에서 쿠키 이름에 `__Host-`를 붙인 이유인데, 이건 [세션 쿠키 편](/blog/signed-session-cookie/)에서 이어 간다.

[다음 편](/blog/id-token-validation/)에서는 이렇게 교환해서 받은 ID Token을 show-gi가 어떻게 검증하는지, 그리고 왜 서명은 보지 않는지 다룬다.
