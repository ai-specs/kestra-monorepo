export function redactOwnedServiceLog(text) {
  return String(text??'').split('\n').map(line=>/token|password|secret|cookie|authorization|Bearer|[?&](?:sig|se|ske|skt|sv)=|eyJ[A-Za-z0-9_-]+\.|[?&](?:state|code)=/i.test(line)
    ?'[credential-bearing line redacted]':line).join('\n')
}
