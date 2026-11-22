/* Hopday on the Home Screen, the Lock Screen and in the Dynamic Island.
   The web app sends the day (current stop, time left, next stop, steps) through HopdayNative.tripStatus;
   App.tsx turns it into a widget timeline and a Live Activity. Code inside 'widget' functions runs in
   iOS's own widget runtime: only @expo/ui components, no hooks, imports or outside constants. */
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { activityBackgroundTint, containerBackground, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding } from "@expo/ui/swift-ui/modifiers";
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
};

const TodayLayout = (p: DayProps, env: WidgetEnvironment) => {
  "widget";
  const NAVY = "#14213D", AMBER = "#FFB020", SOFT = "#C9D2E3";
  const fam = env.widgetFamily || "systemSmall";
  const live = p.mode === "here" || p.mode === "going";
  const head = p.mode === "here" ? "You're here" : p.mode === "going" ? "On the way to" : p.trip || "Hopday";
  const timer = (size: number) => (
    <Text timerInterval={{ lower: new Date(p.from || Date.now()), upper: new Date(p.until) }} countsDown
      modifiers={[font({ size, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER)]} />
  );
  const nextLine = p.next ? (
    <HStack spacing={4}>
      <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(SOFT), lineLimit(1)]}>{"Next: " + p.next}</Text>
      {p.nextAt ? <Text date={new Date(p.nextAt)} dateStyle="time" modifiers={[font({ size: 12 }), foregroundStyle(SOFT)]} /> : null}
    </HStack>
  ) : null;

  if (fam === "accessoryInline") {
    return live ? <Text>{p.mode === "here" ? p.place : "→ " + p.place}</Text> : <Text>{p.note || "Hopday"}</Text>;
  }
  if (fam === "accessoryCircular") {
    return <VStack><Image systemName={p.mode === "here" ? "mappin.circle.fill" : "figure.walk"} size={18} />{live ? <Text timerInterval={{ lower: new Date(p.from || Date.now()), upper: new Date(p.until) }} countsDown modifiers={[font({ size: 11, weight: "bold" }), monospacedDigit()]} /> : <Text modifiers={[font({ size: 11 })]}>{p.steps ? String(p.steps) : "–"}</Text>}</VStack>;
  }
  if (fam === "accessoryRectangular") {
    return (
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ size: 13, weight: "bold" }), lineLimit(1)]}>{live ? p.place : p.trip || "Hopday"}</Text>
        {live ? <HStack spacing={3}><Text timerInterval={{ lower: new Date(p.from || Date.now()), upper: new Date(p.until) }} countsDown modifiers={[font({ size: 13, weight: "semibold" }), monospacedDigit()]} /><Text modifiers={[font({ size: 13 })]}>{p.mode === "here" ? "left" : "to go"}</Text></HStack> : <Text modifiers={[font({ size: 12 }), lineLimit(2)]}>{p.note}</Text>}
        {live && p.next ? <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>{"Next: " + p.next}</Text> : null}
      </VStack>
    );
  }
  if (fam === "systemMedium") {
    return (
      <HStack modifiers={[containerBackground(NAVY, "widget")]} spacing={12}>
        <VStack alignment="leading" spacing={4}>
          <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(SOFT)]}>{head}</Text>
          <Text modifiers={[font({ size: 18, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(2)]}>{live ? p.place : p.note || "Plan your next trip"}</Text>
          {live ? <HStack spacing={4}>{timer(24)}<Text modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]}>{p.mode === "here" ? "left" : "to go"}</Text></HStack> : null}
          <Spacer />
          {nextLine}
        </VStack>
        <Spacer />
        <VStack alignment="trailing" spacing={4}>
          <Image systemName="figure.walk" color={AMBER} size={20} />
          <Text modifiers={[font({ size: 20, weight: "bold", design: "rounded" }), foregroundStyle("#FFFFFF"), monospacedDigit()]}>{p.steps ? String(p.steps) : "–"}</Text>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT)]}>steps today</Text>
        </VStack>
      </HStack>
    );
  }
  /* systemSmall */
  return (
    <VStack alignment="leading" spacing={3} modifiers={[containerBackground(NAVY, "widget")]}>
      <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundStyle(SOFT), lineLimit(1)]}>{head}</Text>
      <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(2)]}>{live ? p.place : p.note || "Plan your next trip"}</Text>
      {live ? timer(22) : null}
      <Spacer />
      {nextLine}
    </VStack>
  );
};

export const TodayWidget = createWidget<DayProps>("HopdayToday", TodayLayout, {
  mode: "idle", trip: "", place: "", from: 0, until: 0, next: "", nextAt: 0, steps: 0, note: "Open Hopday to see your day",
});

const DayActivityLayout = (p: DayProps, env: LiveActivityEnvironment) => {
  "widget";
  const AMBER = env.isLuminanceReduced ? "#FFFFFF" : "#FFB020", SOFT = "#C9D2E3";
  const range = { lower: new Date(p.from || Date.now()), upper: new Date(p.until) };
  const what = p.mode === "here" ? "left here" : "to go";
  const icon = p.mode === "here" ? "mappin.and.ellipse" : "figure.walk";
  return {
    banner: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 14 }), activityBackgroundTint("#14213D")]}>
        <HStack spacing={10}>
          <Image systemName={icon} color={AMBER} size={22} />
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(SOFT)]}>{p.mode === "here" ? "You're here" : "On the way to"}</Text>
            <Text modifiers={[font({ size: 17, weight: "bold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{p.place}</Text>
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={0}>
            <Text timerInterval={range} countsDown modifiers={[font({ size: 26, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER), frame({ width: 96, alignment: "trailing" })]} />
            <Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT)]}>{what}</Text>
          </VStack>
        </HStack>
        {p.next ? (
          <HStack spacing={4}>
            <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(SOFT), lineLimit(1)]}>{"Next: " + p.next}</Text>
            {p.nextAt ? <Text date={new Date(p.nextAt)} dateStyle="time" modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]} /> : null}
          </HStack>
        ) : null}
      </VStack>
    ),
    compactLeading: <Image systemName={icon} color={AMBER} />,
    compactTrailing: <Text timerInterval={range} countsDown modifiers={[monospacedDigit(), foregroundStyle(AMBER), frame({ width: 52 })]} />,
    minimal: <Image systemName={icon} color={AMBER} />,
    expandedLeading: (
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(SOFT)]}>{p.mode === "here" ? "You're here" : "On the way to"}</Text>
        <Text modifiers={[font({ size: 16, weight: "bold" }), lineLimit(1)]}>{p.place}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={0}>
        <Text timerInterval={range} countsDown modifiers={[font({ size: 22, weight: "bold", design: "rounded" }), monospacedDigit(), foregroundStyle(AMBER), frame({ width: 90, alignment: "trailing" })]} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(SOFT)]}>{what}</Text>
      </VStack>
    ),
    expandedBottom: p.next ? (
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 13 }), foregroundStyle(SOFT), lineLimit(1)]}>{"Next: " + p.next}</Text>
        {p.nextAt ? <Text date={new Date(p.nextAt)} dateStyle="time" modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]} /> : null}
      </HStack>
    ) : <Text modifiers={[font({ size: 13 }), foregroundStyle(SOFT)]}>Last stop of the day</Text>,
  };
};

export const DayActivity = createLiveActivity<DayProps>("HopdayDay", DayActivityLayout);
