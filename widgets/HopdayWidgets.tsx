/* Hopday on the Home Screen, the Lock Screen and in the Dynamic Island.
   The web app sends the day (current stop, time left, next stop, steps) through HopdayNative.tripStatus;
   App.tsx turns it into a widget timeline and a Live Activity. Code inside 'widget' functions runs in
   iOS's own widget runtime: only @expo/ui components, no hooks, imports or outside constants. */
import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { activityBackgroundTint, background, containerBackground, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, shapes, tint } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, createWidget, type LiveActivityEnvironment, type WidgetEnvironment } from "expo-widgets";

export type DayProps = {
  /* here: at a stop · going: on the way to the next one · done: day finished · idle: no trip today */
  mode: "here" | "going" | "done" | "idle";
  trip: string;
  place: string;   // where you are (here) or where you're going (going)
  from: number;    // ms: when you arrived / left
  until: number;   // ms: time to leave (here) or planned arrival (going)
  next: string;    // the stop after
  nextAt: number;  // ms: planned time at the stop after
  steps: number;
  note: string;    // idle / done line, e.g. "Madrid in 3 days"
  travel: string;  // how you get to the next stop: walking · transit · taxi · driving · bicycling
  /* the words, already in the app's language */
  lHere: string; lGoing: string; lLeft: string; lToGo: string; lNext: string; lSteps: string; lLast: string;
};

const TodayLayout = (p: DayProps, env: WidgetEnvironment) => {
  "widget";
  const NAVY = "#14213D", AMBER = "#FFB020", SOFT = "#AEB9CF";
  const fam = env.widgetFamily || "systemSmall";
  const live = p.mode === "here" || p.mode === "going";
  const icon = p.mode === "here" ? "mappin.and.ellipse" : p.travel === "transit" ? "tram.fill" : p.travel === "taxi" || p.travel === "driving" ? "car.fill" : p.travel === "bicycling" ? "bicycle" : "figure.walk";
  const head = p.mode === "here" ? (p.lHere || "You're here") : p.mode === "going" ? (p.lGoing || "On the way to") : p.trip || "Hopday";
  const what = p.mode === "here" ? (p.lLeft || "left") : (p.lToGo || "to go");
  const range = { lower: new Date(p.from || Date.now()), upper: new Date(p.until || Date.now() + 60000) };
  const badge = (size: number) => (
    <Image systemName={live ? icon : "suitcase.fill"} size={size * 0.5} color={NAVY}
      modifiers={[frame({ width: size, height: size }), background(AMBER, shapes.circle())]} />
  );
  const timer = (size: number) => (
    <Text timerInterval={range} countsDown modifiers={[font({ size, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER)]} />
  );
  const bar = <ProgressView timerInterval={range} countsDown={false} modifiers={[tint(AMBER)]} />;

  if (fam === "accessoryInline") {
    return live ? <Text>{(p.mode === "here" ? "📍 " : "→ ") + p.place}</Text> : <Text>{p.note || "Hopday"}</Text>;
  }
  if (fam === "accessoryCircular") {
    return <VStack spacing={1}><Image systemName={live ? icon : "figure.walk"} size={16} />{live ? <Text timerInterval={range} countsDown modifiers={[font({ size: 11, weight: "bold" }), monospacedDigit()]} /> : <Text modifiers={[font({ size: 11 })]}>{p.steps ? String(p.steps) : "–"}</Text>}</VStack>;
  }
  if (fam === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={2}>
        <HStack spacing={4}>
          <Image systemName={live ? icon : "suitcase.fill"} size={12} />
          <Text modifiers={[font({ size: 13, weight: "bold" }), lineLimit(1)]}>{live ? p.place : p.trip || "Hopday"}</Text>
        </HStack>
        {live ? <HStack spacing={3}><Text timerInterval={range} countsDown modifiers={[font({ size: 15, weight: "bold", design: "rounded" }), monospacedDigit()]} /><Text modifiers={[font({ size: 12 })]}>{what}</Text></HStack> : <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{p.note}</Text>}
        {live ? bar : null}
      </VStack>
    );
  }
  /* Option A, "big countdown": the place on top, a large countdown, the bar, then the next stop */
  const nextLine = (sz: number) => p.next ? (
    <HStack spacing={4}>
      <Text modifiers={[font({ size: sz }), foregroundStyle(SOFT), lineLimit(1)]}>{(p.lNext || "Next:") + " "}</Text>
      {p.nextAt ? <Text date={new Date(p.nextAt)} dateStyle="time" modifiers={[font({ size: sz, weight: "semibold" }), foregroundStyle("#FFFFFF")]} /> : null}
      <Text modifiers={[font({ size: sz, weight: "semibold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{p.next}</Text>
    </HStack>
  ) : <Text modifiers={[font({ size: sz }), foregroundStyle(SOFT), lineLimit(1)]}>{p.lLast || "Last stop of the day"}</Text>;
  const liveCard = (big: number, placeSize: number, nextSize: number) => (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(SOFT), lineLimit(1)]}>{head}</Text>
        <Spacer />
        {badge(22)}
      </HStack>
      <Text modifiers={[font({ size: placeSize, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{p.place}</Text>
      <Spacer />
      <HStack spacing={5} alignment="firstTextBaseline">{timer(big)}<Text modifiers={[font({ size: 13, weight: "medium" }), foregroundStyle(SOFT)]}>{what}</Text></HStack>
      {bar}
      {nextLine(nextSize)}
    </VStack>
  );
  const idleCard = (big: number) => (
    <VStack alignment="leading" spacing={4}>
      <HStack spacing={6}>
        <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{p.trip || "Hopday"}</Text>
        <Spacer />
        {badge(22)}
      </HStack>
      <Spacer />
      <Text modifiers={[font({ size: big, weight: "bold", design: "rounded" }), foregroundStyle(AMBER), lineLimit(2)]}>{p.note || "Plan your next trip"}</Text>
      {p.steps ? <HStack spacing={4}><Image systemName="figure.walk" color={SOFT} size={11} /><Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT), monospacedDigit()]}>{String(p.steps) + " " + (p.lSteps || "steps today")}</Text></HStack> : null}
    </VStack>
  );
  if (fam === "systemMedium") {
    return <VStack alignment="leading" modifiers={[containerBackground(NAVY, "widget")]}>{live ? liveCard(40, 19, 13) : idleCard(26)}</VStack>;
  }
  /* systemSmall */
  return <VStack alignment="leading" modifiers={[containerBackground(NAVY, "widget")]}>{live ? liveCard(32, 15, 11) : idleCard(20)}</VStack>;
};

export const TodayWidget = createWidget<DayProps>("HopdayToday", TodayLayout, {
  mode: "idle", trip: "", place: "", from: 0, until: 0, next: "", nextAt: 0, steps: 0, note: "Open Hopday to see your day", travel: "walking",
  lHere: "", lGoing: "", lLeft: "", lToGo: "", lNext: "", lSteps: "", lLast: "",
});

const DayActivityLayout = (p: DayProps, env: LiveActivityEnvironment) => {
  "widget";
  const NAVY = "#14213D", AMBER = env.isLuminanceReduced ? "#FFFFFF" : "#FFB020", SOFT = "#AEB9CF";
  const range = { lower: new Date(p.from || Date.now()), upper: new Date(p.until || Date.now() + 60000) };
  const what = p.mode === "here" ? (p.lLeft || "left here") : (p.lToGo || "to go");
  const head = p.mode === "here" ? (p.lHere || "You're here") : (p.lGoing || "On the way to");
  const icon = p.mode === "here" ? "mappin.and.ellipse" : p.travel === "transit" ? "tram.fill" : p.travel === "taxi" || p.travel === "driving" ? "car.fill" : p.travel === "bicycling" ? "bicycle" : "figure.walk";
  const nextRow = p.next ? (
    <HStack spacing={5}>
      <Image systemName="arrow.turn.down.right" size={12} color={SOFT} />
      <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(SOFT), lineLimit(1)]}>{(p.lNext || "Next:") + " " + p.next}</Text>
      {p.nextAt ? <Text date={new Date(p.nextAt)} dateStyle="time" modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]} /> : null}
    </HStack>
  ) : <Text modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]}>{p.lLast || "Last stop of the day"}</Text>;
  return {
    banner: (
      <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 }), activityBackgroundTint(NAVY)]}>
        <HStack spacing={12}>
          <Image systemName={icon} size={18} color={NAVY} modifiers={[frame({ width: 40, height: 40 }), background(AMBER, shapes.circle())]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(SOFT)]}>{head}</Text>
            <Text modifiers={[font({ size: 18, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{p.place}</Text>
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={0}>
            <Text timerInterval={range} countsDown modifiers={[font({ size: 30, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER), frame({ width: 110, alignment: "trailing" })]} />
            <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle(SOFT)]}>{what}</Text>
          </VStack>
        </HStack>
        <ProgressView timerInterval={range} countsDown={false} modifiers={[tint(AMBER)]} />
        {nextRow}
      </VStack>
    ),
    compactLeading: <Image systemName={icon} color={AMBER} />,
    compactTrailing: <Text timerInterval={range} countsDown modifiers={[monospacedDigit(), foregroundStyle(AMBER), frame({ width: 52 })]} />,
    minimal: <Image systemName={icon} color={AMBER} />,
    expandedLeading: (
      <HStack spacing={8} modifiers={[padding({ leading: 4 })]}>
        <Image systemName={icon} size={15} color={NAVY} modifiers={[frame({ width: 32, height: 32 }), background(AMBER, shapes.circle())]} />
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT)]}>{head}</Text>
          <Text modifiers={[font({ size: 15, weight: "bold" }), lineLimit(1)]}>{p.place}</Text>
        </VStack>
      </HStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={0}>
        <Text timerInterval={range} countsDown modifiers={[font({ size: 24, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER), frame({ width: 92, alignment: "trailing" })]} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT)]}>{what}</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={8}>
        <ProgressView timerInterval={range} countsDown={false} modifiers={[tint(AMBER)]} />
        {nextRow}
      </VStack>
    ),
  };
};

export const DayActivity = createLiveActivity<DayProps>("HopdayDay", DayActivityLayout);
