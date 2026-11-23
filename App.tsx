import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import * as WebBrowser from "expo-web-browser";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import * as SplashScreen from "expo-splash-screen";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as StoreReview from "expo-store-review";
import { after } from "expo-widgets";
import { DayActivity, TodayWidget, type DayProps } from "./widgets/HopdayWidgets";
import {
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";

SplashScreen.preventAutoHideAsync().catch(() => {});

const HOME = "https://hopday.app/";
const HOSTS = ["hopday.app", "www.hopday.app", "trips.uniforms-udc.com"];
const AUTH_CALLBACK = "hopday://auth";
const NAVY = "#14213D";

/* What the web app sees inside the iPhone app: window.HopdayNative */
const BRIDGE = `
(function(){
  if (window.HopdayNative) return;
  var n = 0, waiting = {};
  function call(type, data){
    return new Promise(function(resolve, reject){
      var id = ++n; waiting[id] = {resolve: resolve, reject: reject};
      window.ReactNativeWebView.postMessage(JSON.stringify({id: id, type: type, data: data || {}}));
    });
  }
  window.__hnReply = function(id, ok, value){ var w = waiting[id]; if (!w) return; delete waiting[id]; ok ? w.resolve(value) : w.reject(new Error(value || "failed")); };
  window.HopdayNative = {
    platform: "ios",
    version: 3,
    /* steps walked on a day ("YYYY-MM-DD", the phone's own time zone) from Apple Health */
    steps: function(date){ return call("steps", {date: date}); },
    /* opens the iPhone share menu with a file (data URL: picture, CSV, PDF, calendar) */
    shareFile: function(dataUrl, name){ return call("shareFile", {dataUrl: dataUrl, name: name}); },
    /* Sign in with Apple: returns {token, nonce, name, email} for Supabase signInWithIdToken */
    appleSignIn: function(){ return call("appleSignIn", {}); },
    /* a small tap you can feel: "tap" | "select" | "success" | "warning" | "error" */
    haptic: function(kind){ return call("haptic", {kind: kind}).catch(function(){}); },
    /* Apple's own "Enjoying Hopday?" rating prompt (Apple decides if and when it shows) */
    askReview: function(){ return call("askReview", {}); },
    /* opens a web page in a sheet inside the app instead of leaving to Safari */
    openLink: function(url){ return call("openLink", {url: url}); },
    /* the day for the Home/Lock Screen widget and the Live Activity: {timeline:[{at, props}], live: props|null, liveOn: bool} */
    tripStatus: function(s){ return call("tripStatus", s || {}); }
  };
  var mark = function(){ if (document.documentElement) document.documentElement.classList.add("in-ios-app"); };
  mark(); document.addEventListener("DOMContentLoaded", mark);
  try { window.dispatchEvent(new Event("hopday-native")); } catch(e) {}
})();
true;
`;

function dayRange(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

async function haptic(kind: string) {
  if (kind === "success") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  if (kind === "warning") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  if (kind === "error") return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  if (kind === "select") return Haptics.selectionAsync();
  return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

async function askReview() {
  if (!(await StoreReview.isAvailableAsync())) return false;
  await StoreReview.requestReview();
  return true;
}

/* map and phone links go to their own apps; other web pages open in a sheet inside Hopday */
function isAppLink(url: string) {
  return /^(tel|mailto|sms|maps|comgooglemaps|whatsapp):/i.test(url) || /^https:\/\/(maps\.apple\.com|maps\.google\.|www\.google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|apps\.apple\.com|wa\.me)/i.test(url);
}
async function openLink(url: string) {
  if (!/^https?:\/\//i.test(url) || isAppLink(url)) { await Linking.openURL(url); return true; }
  await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, controlsColor: "#2B4FD8", dismissButtonStyle: "done" });
  return true;
}

/* Widgets and the Lock Screen Live Activity */
const w = (x: any) => String(x || "").slice(0, 40);
const clean = (p: any): DayProps => ({
  mode: ["here", "going", "done", "idle"].includes(p?.mode) ? p.mode : "idle",
  trip: String(p?.trip || "").slice(0, 60), place: String(p?.place || "").slice(0, 80),
  from: Number(p?.from) || 0, until: Number(p?.until) || 0,
  next: String(p?.next || "").slice(0, 80), nextAt: Number(p?.nextAt) || 0,
  steps: Math.max(0, Math.round(Number(p?.steps) || 0)), note: String(p?.note || "").slice(0, 80),
  travel: ["walking", "transit", "taxi", "driving", "bicycling"].includes(p?.travel) ? p.travel : "walking",
  lHere: w(p?.lHere), lGoing: w(p?.lGoing), lLeft: w(p?.lLeft), lToGo: w(p?.lToGo), lNext: w(p?.lNext), lSteps: w(p?.lSteps), lLast: w(p?.lLast),
});
let lastLive = "";
async function tripStatus(data: any) {
  const timeline = Array.isArray(data?.timeline) ? data.timeline.slice(0, 40) : [];
  if (timeline.length) TodayWidget.updateTimeline(timeline.map((e: any) => ({ date: new Date(Number(e.at) || Date.now()), props: clean(e.props) })));
  else TodayWidget.updateSnapshot(clean(data?.now || {}));
  const running = DayActivity.getInstances();
  const live = data?.live && data?.liveOn !== false ? clean(data.live) : null;
  if (live && (live.mode === "here" || live.mode === "going") && live.until > Date.now() - 60000) {
    const key = JSON.stringify(live);
    if (key === lastLive && running.length) return "same";
    lastLive = key;
    const stale = new Date(Math.max(live.until, live.nextAt || 0) + 30 * 60000);
    if (running.length) { await running[0].update(live, stale); for (const r of running.slice(1)) await r.end("immediate"); return "updated"; }
    DayActivity.start(live, "hopday://", stale);
    return "started";
  }
  lastLive = "";
  for (const r of running) await r.end(data?.dayDone ? after(new Date(Date.now() + 15 * 60000)) : "immediate");
  return running.length ? "ended" : "none";
}

let healthAsked = false;
async function stepsFor(date: string): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("bad date");
  if (!(await isHealthDataAvailable())) throw new Error("Health isn't available on this device");
  if (!healthAsked) {
    await requestAuthorization({ toRead: ["HKQuantityTypeIdentifierStepCount"] });
    healthAsked = true;
  }
  const { start, end } = dayRange(date);
  const res = await queryStatisticsForQuantity("HKQuantityTypeIdentifierStepCount", ["cumulativeSum"], {
    filter: { date: { startDate: start, endDate: end } },
    unit: "count",
  });
  return Math.round(res.sumQuantity?.quantity ?? 0);
}

const EXT: Record<string, [string, string]> = {
  "image/png": ["png", "public.png"],
  "image/jpeg": ["jpg", "public.jpeg"],
  "text/csv": ["csv", "public.comma-separated-values-text"],
  "application/pdf": ["pdf", "com.adobe.pdf"],
  "text/calendar": ["ics", "public.calendar-event"],
  "text/plain": ["txt", "public.plain-text"],
};
async function shareFile(dataUrl: string, name?: string) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl || "");
  if (!m || !EXT[m[1].toLowerCase()]) throw new Error("this kind of file can't be shared");
  const [ext, uti] = EXT[m[1].toLowerCase()];
  const safe = (name || "hopday").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "hopday";
  const file = new File(Paths.cache, `${safe}.${ext}`);
  if (file.exists) file.delete();
  file.create();
  file.write(m[2], { encoding: "base64" });
  await Sharing.shareAsync(file.uri, { mimeType: m[1], UTI: uti });
  return true;
}

/* Native Sign in with Apple. Supabase checks the token against the hashed nonce. */
async function appleSignIn() {
  if (!(await AppleAuthentication.isAvailableAsync())) throw new Error("Sign in with Apple isn't available on this device");
  const nonce = Array.from(Crypto.getRandomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("");
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const c = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!c.identityToken) throw new Error("Apple didn't return a sign-in token");
    const name = [c.fullName?.givenName, c.fullName?.familyName].filter(Boolean).join(" ");
    return { token: c.identityToken, nonce, name, email: c.email || "" };
  } catch (e: any) {
    if (e?.code === "ERR_REQUEST_CANCELED") return { cancelled: true };
    throw e;
  }
}

export default function App() {
  const web = useRef<WebView>(null);
  const [uri, setUri] = useState(HOME);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, []);

  const reply = (id: number, ok: boolean, value: unknown) => {
    web.current?.injectJavaScript(`window.__hnReply(${id}, ${ok}, ${JSON.stringify(value ?? null)}); true;`);
  };

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { id: number; type: string; data: any };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    try {
      if (msg.type === "steps") reply(msg.id, true, await stepsFor(String(msg.data.date)));
      else if (msg.type === "appleSignIn") reply(msg.id, true, await appleSignIn());
      else if (msg.type === "haptic") reply(msg.id, true, await haptic(String(msg.data.kind || "tap")));
      else if (msg.type === "askReview") reply(msg.id, true, await askReview());
      else if (msg.type === "tripStatus") reply(msg.id, true, await tripStatus(msg.data));
      else if (msg.type === "openLink") reply(msg.id, true, await openLink(String(msg.data.url || "")));
      else if (msg.type === "shareFile") reply(msg.id, true, await shareFile(msg.data.dataUrl, msg.data.name));
      else reply(msg.id, false, "unknown");
    } catch (err: any) {
      reply(msg.id, false, String(err?.message || err));
    }
  }, []);

  /* Google (and other) sign-in opens in Apple's secure sign-in window, then comes back into the app */
  const signIn = useCallback(async (authorizeUrl: string) => {
    const u = new URL(authorizeUrl);
    u.searchParams.set("redirect_to", AUTH_CALLBACK);
    const res = await WebBrowser.openAuthSessionAsync(u.toString(), AUTH_CALLBACK);
    if (res.type !== "success" || !res.url) {
      /* window closed without finishing: take the page back to the sign-in buttons */
      web.current?.injectJavaScript(`try{ busy(false); }catch(e){} true;`);
      return;
    }
    const back = res.url.replace(/^hopday:\/\/auth\/?/, "");
    if (back.startsWith("#")) {
      /* hand the login to the open page (changing only the #part would not reload it) */
      web.current?.injectJavaScript(`location.hash=${JSON.stringify(back)}; if(window.__hnTakeAuth) window.__hnTakeAuth(); true;`);
    } else {
      setUri(HOME + (back.startsWith("?") ? back : ""));
    }
  }, []);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url;
    if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
    if (/\/auth\/v1\/authorize\?/.test(url)) { signIn(url); return false; }
    let host = "";
    try { host = new URL(url).host; } catch { /* tel:, mailto:, maps: … */ }
    if (HOSTS.includes(host)) return true;
    if (!req.isTopFrame) return true; // embedded maps, players
    if (host.endsWith(".supabase.co")) return true; // sign-in emails that land here
    openLink(url).catch(() => {});
    return false;
  }, [signIn]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.title}>No connection</Text>
          <Text style={styles.text}>Hopday needs the internet the first time it opens. Check your connection and try again.</Text>
          <Pressable style={styles.btn} onPress={() => { setFailed(false); web.current?.reload(); }}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      <WebView
        ref={web as any}
        source={{ uri }}
        style={failed ? [styles.web, styles.hidden] : styles.web}
        injectedJavaScriptBeforeContentLoaded={BRIDGE}
        injectedJavaScript={BRIDGE}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStart}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onLoadEnd={() => { setReady(true); SplashScreen.hideAsync().catch(() => {}); }}
        onError={(e: any) => { if (!ready || /offline|internet|-1009/i.test(e.nativeEvent.description || "")) setFailed(true); }}
        onContentProcessDidTerminate={() => web.current?.reload()}
        applicationNameForUserAgent="HopdayApp/1.0"
        limitsNavigationsToAppBoundDomains
        allowsBackForwardNavigationGestures
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        sharedCookiesEnabled
        pullToRefreshEnabled={false}
        bounces={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.center, StyleSheet.absoluteFill]}>
            <ActivityIndicator color="#FFB020" size="large" />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  web: { flex: 1, backgroundColor: NAVY },
  hidden: { opacity: 0, position: "absolute", width: 1, height: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: NAVY },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", marginBottom: 10 },
  text: { color: "#C9D2E3", fontSize: 16, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  btn: { backgroundColor: "#FFB020", paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: NAVY, fontWeight: "800", fontSize: 16 },
});
