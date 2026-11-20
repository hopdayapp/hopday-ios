import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import * as WebBrowser from "expo-web-browser";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import * as SplashScreen from "expo-splash-screen";
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
    version: 1,
    /* steps walked on a day ("YYYY-MM-DD", the phone's own time zone) from Apple Health */
    steps: function(date){ return call("steps", {date: date}); },
    /* opens the iPhone share menu with a file (data URL: picture, CSV, PDF, calendar) */
    shareFile: function(dataUrl, name){ return call("shareFile", {dataUrl: dataUrl, name: name}); }
  };
  document.documentElement.classList.add("in-ios-app");
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
    if (res.type !== "success" || !res.url) return;
    const back = res.url.replace(/^hopday:\/\/auth\/?/, "");
    setUri(HOME + (back.startsWith("?") || back.startsWith("#") ? back : ""));
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
    Linking.openURL(url).catch(() => {});
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
        onLoadEnd={() => { setReady(true); SplashScreen.hideAsync().catch(() => {}); }}
        onError={(e: any) => { if (!ready || /offline|internet|-1009/i.test(e.nativeEvent.description || "")) setFailed(true); }}
        onContentProcessDidTerminate={() => web.current?.reload()}
        applicationNameForUserAgent="HopdayApp/1.0"
        limitsNavigationsToAppBoundDomains
        allowsBackForwardNavigationGestures
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
