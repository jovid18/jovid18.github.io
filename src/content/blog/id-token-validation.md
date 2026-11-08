---
title: ID Token 서명을 검증하지 않아도 되는 경우
description: 서버가 토큰 엔드포인트에서 직접 받은 ID Token은 서명 검증을 생략할 수 있다. 그래도 iss·aud·exp는 왜 보는지 show-gi 코드로 정리한 기록.
publishedAt: 2026-10-29
domain: backend
project: show-gi
type: design
topics:
  - oidc
  - jwt
  - auth
draft: true
---

[첫 편](/blog/oidc-vs-oauth2/)에서 ID Token을 받으면 서명, `iss`, `aud`, `exp`를 꼭 검증해야 한다고 썼다. 그런데 show-gi의 로그인 코드는 서명을 보지 않는다. JWT 라이브러리도 없고, ID Token을 base64로 풀어 JSON으로 읽는 게 전부다.

빼먹은 게 아니라 일부러 뺀 것이다. 왜 그래도 되는지, 그리고 서명을 안 봐도 클레임은 왜 봐야 하는지 정리해 둔다.

### 서명은 무엇을 증명하나

ID Token의 서명은 "이 토큰은 구글이 만들었고, 그 뒤로 한 글자도 바뀌지 않았다"를 증명한다. 이게 필요한 건 토큰이 **믿을 수 없는 길을 거쳐서** 올 때다.

첫 편의 채팅앱은 모바일 앱이 구글에서 ID Token을 받아 서버로 보냈다. 서버 입장에서 그 토큰은 클라이언트가 보낸 요청 본문에 실려 왔을 뿐이다. 진짜 앱이 보냈는지, 운세앱 운영자가 흉내 낸 요청인지, 누가 중간에 고쳤는지 알 수 없다. 그래서 서명으로 구글이 만든 토큰인지부터 확인해야 했다.

show-gi는 다르다. ID Token이 브라우저를 거치지 않는다.

1. 브라우저는 콜백 주소로 code만 들고 온다
2. 서버가 그 code를 들고 `https://oauth2.googleapis.com/token`을 **직접** 부른다
3. ID Token은 그 HTTPS 응답 본문으로 온다

이 응답이 구글에서 왔다는 건 TLS가 이미 확인했다. 인증서가 `oauth2.googleapis.com`의 것이 아니었다면 연결이 맺어지지도 않았다. 가운데에 끼어들 자리가 없으니, 토큰 안의 서명으로 같은 사실을 한 번 더 확인할 이유가 없다.

이건 show-gi가 만든 예외가 아니다. OIDC Core 3.1.3.7절은 토큰 엔드포인트와 직접 통신해서 받은 ID Token이라면 서명 대신 TLS 서버 검증으로 발급자를 확인해도 된다고 적어 두었다. 구글의 OpenID Connect 문서도 같은 경우를 예외로 든다.

### 그래서 JWT 라이브러리를 넣지 않았다

서명 검증을 하려면 구글의 공개키를 받아 와야 한다. 공개키는 JWKS 엔드포인트에 있고, 주기적으로 바뀌니 캐시하고 갱신하는 코드가 필요하다. 보통은 이걸 JWT 라이브러리에 맡긴다.

서명을 안 보기로 하니 남는 일은 base64 한 번, JSON 한 번이었다.

```go
func (g *Google) identityFrom(idToken string, now time.Time) (Identity, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return Identity{}, fmt.Errorf("auth: id_token is not a JWT")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	// ...
	var claims struct {
		Iss   string `json:"iss"`
		Sub   string `json:"sub"`
		Aud   string `json:"aud"`
		Exp   int64  `json:"exp"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	// ...
}
```

같은 이유로 엔드포인트 주소도 상수로 박아 두었다. OIDC에는 `/.well-known/openid-configuration`에서 엔드포인트를 알아내는 Discovery가 있지만, 그걸 쓰면 서버가 뜰 때마다 외부 호출이 하나 더 생기고 그 호출이 실패하면 로그인 전체가 꺼진다. 구글 하나만 붙이는 동안은 상수가 더 단단하다.

### 서명을 안 봐도 클레임은 본다

처음 코드는 `sub`가 있는지와 `aud`가 우리 client_id인지만 봤다. `aud`는 설정 실수를 잡으려는 용도였다. 환경 변수에 다른 프로젝트의 client_id가 들어가 있으면 여기서 걸린다.

OIDC Core는 서명 검증을 생략해도 `iss`, `aud`, `exp` 검증은 생략하라고 하지 않는다. 이번에 RFC 9700과 OIDC Core를 대조하면서 나머지 둘도 넣었다.

```go
var issuers = map[string]bool{
	"https://accounts.google.com": true,
	"accounts.google.com":         true,
}

if !issuers[claims.Iss] {
	return Identity{}, fmt.Errorf("auth: id_token was issued by %q", claims.Iss)
}
if claims.Aud != g.clientID {
	return Identity{}, fmt.Errorf("auth: id_token was issued for another client")
}
if now.Unix() >= claims.Exp {
	return Identity{}, fmt.Errorf("auth: id_token has expired")
}
```

- `iss`: 구글은 스킴이 붙은 값과 없는 값을 섞어서 쓴다. 둘 다 받아야 정상 로그인이 실패하지 않는다
- `aud`: 이 토큰이 우리 앱에게 발급된 것인지 확인한다
- `exp`: 방금 받은 토큰이 만료됐을 리는 거의 없지만, 서버 시계가 크게 틀어졌거나 응답이 어딘가에서 재사용되는 상황을 잡는다

TLS가 지켜 주는 건 "구글이 보낸 응답"이라는 것까지다. 그 응답이 **우리에게, 지금 유효한** 토큰인지는 여전히 우리가 확인해야 한다. 서명 검증과 클레임 검증은 서로 다른 질문에 답한다.

### aud가 배열이면 거부한다

OIDC 명세에서 `aud`는 문자열일 수도 있고 배열일 수도 있다. 토큰 하나를 여러 앱이 같이 받는 경우다. 배열이면 `azp` 클레임으로 "실제로 이 토큰을 요청한 앱"까지 확인해야 한다.

구글은 `aud`를 문자열로 준다. 배열을 받아 줄 이유가 없으니 show-gi는 `Aud`를 `string`으로만 선언했다. 배열이 오면 JSON 해석 단계에서 실패하고 로그인이 거부된다. 따로 분기를 짜지 않아도 타입 선언이 그 일을 한다.

### refresh token도 받지 않는다

구글로 가는 주소에는 `access_type=online`을 넣었다. 이러면 refresh token이 오지 않는다.

refresh token은 사용자가 없을 때도 구글 API를 대신 부르려고 받는 것이다. show-gi는 로그인할 때 그 사람이 누구인지만 알면 되고, 그 뒤로 구글 API를 부를 일이 없다. 받아 두면 쓰지도 않으면서 안전하게 보관할 의무만 생긴다.

### 이 예외가 깨지는 순간

이 설계는 "ID Token은 서버가 토큰 엔드포인트에서 직접 받는다"는 전제 위에 서 있다. 전제가 바뀌면 서명 검증을 다시 넣어야 한다.

- 모바일 앱을 만들어 앱이 받은 ID Token을 서버로 보내게 하는 경우
- 구글의 원탭 로그인처럼 브라우저 쪽에서 ID Token을 받아 서버로 넘기는 방식을 붙이는 경우

둘 다 토큰이 클라이언트를 거쳐 온다. 첫 편의 운세앱 공격이 그대로 통하는 자리라, 그때는 JWKS로 서명을 확인하는 라이브러리를 들이는 게 맞다.

[다음 편](/blog/signed-session-cookie/)에서는 로그인이 끝난 뒤의 이야기, show-gi가 세션을 DB 대신 서명 쿠키로 들고 다니는 방식과 그 쿠키를 지키는 방법을 다룬다.
