import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { supabase } from "./lib/supabase";

type Genre = "all" | "party" | "live" | "szene" | "chill";
type EventRecord = {
  id: string;
  title: string;
  type: string;
  genre: Exclude<Genre, "all">;
  starts_at: string;
  place: "city" | "nearby";
  date_group: "today" | "weekend" | "week" | "all";
  venue: string;
  price: string;
  poster: number;
  art: string;
  description: string;
  is_public: boolean;
  image_url?: string | null;
};
type Profile = { role: "user" | "admin"; email: string | null };

const colors = {
  ink: "#f1e9e5",
  muted: "#c8bbc2",
  paper: "#2d2b30",
  panel: "rgba(70, 63, 72, .92)",
  panelStrong: "#403b40",
  accent: "#c3d0a1",
  pink: "#ec8bb9",
  border: "rgba(255,239,231,.16)"
};

const genreOptions: { value: Genre; label: string }[] = [
  { value: "all", label: "Alle Genres" },
  { value: "party", label: "Party & Rave" },
  { value: "live", label: "Live & Konzert" },
  { value: "szene", label: "Szene" },
  { value: "chill", label: "Ruhig & Draußen" }
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Button({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondaryButton]}><Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text></Pressable>;
}

function EventCard({ event, onPress }: { event: EventRecord; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={[styles.poster, { backgroundColor: ["#764e70", "#526d65", "#716782", "#75634f", "#62515e"][event.poster % 5] }]}>
        {event.image_url ? <Image source={{ uri: event.image_url }} style={styles.posterImage} resizeMode="cover" /> : <Text style={styles.posterText}>{event.art || event.title}</Text>}
        <Text style={styles.posterDate}>{formatDate(event.starts_at).split(",")[0]}</Text>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.tag}>{event.type}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.cardMeta}>{formatDate(event.starts_at)} · {event.venue}</Text>
        <Text style={styles.price}>{event.price}</Text>
      </View>
    </Pressable>
  );
}

export default function App() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [adminEvents, setAdminEvents] = useState<EventRecord[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [genre, setGenre] = useState<Genre>("all");
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<"all" | "city" | "nearby">("all");
  const [dateGroup, setDateGroup] = useState<"all" | "today" | "weekend" | "week" | "custom">("all");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [visibleEventLimit, setVisibleEventLimit] = useState(12);
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventVenue, setNewEventVenue] = useState("");
  const [newEventDate, setNewEventDate] = useState("");

  const loadEvents = async () => {
    const { data, error } = await supabase.from("events").select("*").eq("is_public", true).eq("status", "published").order("sort_order").order("starts_at");
    if (error) {
      Alert.alert("Events konnten nicht geladen werden", error.message);
      return;
    }
    setEvents((data ?? []) as EventRecord[]);
  };

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("role,email").eq("id", userId).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  };

  const loadAdminEvents = async () => {
    const { data, error } = await supabase.from("events").select("*").order("sort_order").order("starts_at");
    if (error) {
      Alert.alert("Admin-Events konnten nicht geladen werden", error.message);
      return;
    }
    setAdminEvents((data ?? []) as EventRecord[]);
  };

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSessionEmail(data.session.user.email ?? null);
        await loadProfile(data.session.user.id);
      }
      await loadEvents();
      setLoading(false);
    })();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSessionEmail(nextSession?.user.email ?? null);
      if (nextSession) {
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
        setAdminEvents([]);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("de");
    return events.filter((event) => {
      const matchesGenre = genre === "all" || event.genre === genre;
      const matchesPlace = place === "all" || event.place === place;
      const eventDate = new Date(event.starts_at);
      const eventDateKey = Number.isNaN(eventDate.getTime()) ? "" : [
        eventDate.getFullYear(),
        String(eventDate.getMonth() + 1).padStart(2, "0"),
        String(eventDate.getDate()).padStart(2, "0"),
      ].join("-");
      const customEnd = dateEnd || dateStart;
      const hasCustomDateRange = /^\d{4}-\d{2}-\d{2}$/.test(dateStart);
      const matchesQuickDate = dateGroup === "all" || dateGroup === "custom" || !hasCustomDateRange && event.date_group === dateGroup;
      const matchesCustomDate = !hasCustomDateRange || eventDateKey >= dateStart && eventDateKey <= customEnd;
      const matchesQuery = !normalized || `${event.title} ${event.type} ${event.venue}`.toLocaleLowerCase("de").includes(normalized);
      return matchesGenre && matchesPlace && matchesQuickDate && matchesCustomDate && matchesQuery;
    }).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [dateEnd, dateGroup, dateStart, events, genre, place, query]);
  const visibleEvents = filteredEvents.slice(0, visibleEventLimit);

  useEffect(() => {
    setVisibleEventLimit(12);
  }, [dateGroup, genre, place, query]);

  const surprise = () => {
    if (!filteredEvents.length) {
      Alert.alert("Keine passenden Events", "Ändere zuerst deine Filter.");
      return;
    }
    setSelected(filteredEvents[Math.floor(Math.random() * filteredEvents.length)]);
  };

  const authenticate = async () => {
    setAuthBusy(true);
    setAuthMessage("");
    const result = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password });
    setAuthBusy(false);
    if (result.error) {
      setAuthMessage(result.error.message);
      return;
    }
    setAuthMessage(authMode === "register" ? "Bitte bestätige deine E-Mail-Adresse." : "Du bist angemeldet.");
    if (authMode === "login") setAuthOpen(false);
  };

  const createEvent = async () => {
    if (!sessionEmail || !newEventTitle.trim() || !newEventVenue.trim() || !newEventDate.trim()) {
      Alert.alert("Angaben fehlen", "Titel, Datum und Location werden benötigt.");
      return;
    }
    const { error } = await supabase.from("events").insert({
      title: newEventTitle.trim(),
      type: "Community",
      genre: "chill",
      starts_at: new Date(newEventDate).toISOString(),
      date_group: "all",
      place: "city",
      venue: newEventVenue.trim(),
      price: "Eintritt frei",
      poster: 1,
      art: newEventTitle.trim().toUpperCase(),
      description: "",
      created_by: (await supabase.auth.getUser()).data.user?.id,
      is_public: false,
      status: "needs_review",
      origin: "organizer"
    });
    if (error) {
      Alert.alert("Event konnte nicht angelegt werden", error.message);
      return;
    }
    setOrganizerOpen(false);
    setNewEventTitle("");
    setNewEventVenue("");
    setNewEventDate("");
    Alert.alert("Event eingereicht", "Das Event wartet auf die Freigabe durch einen Admin.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setAdminOpen(false);
  };

  const updateEventVisibility = async (event: EventRecord) => {
    const { error } = await supabase.from("events").update({
      is_public: !event.is_public,
      status: event.is_public ? "needs_review" : "published"
    }).eq("id", event.id);
    if (error) {
      Alert.alert("Event konnte nicht aktualisiert werden", error.message);
      return;
    }
    await Promise.all([loadEvents(), loadAdminEvents()]);
  };

  const deleteEvent = (event: EventRecord) => {
    Alert.alert("Event löschen?", event.title, [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Löschen",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("events").delete().eq("id", event.id);
          if (error) {
            Alert.alert("Event konnte nicht gelöscht werden", error.message);
            return;
          }
          await Promise.all([loadEvents(), loadAdminEvents()]);
        }
      }
    ]);
  };

  if (loading) return <SafeAreaView style={styles.safe}><ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Image source={require("./assets/icon.png")} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerActions}>
          {sessionEmail ? <Button label="Abmelden" onPress={() => void signOut()} secondary /> : <Button label="Anmelden" onPress={() => setAuthOpen(true)} secondary />}
          {profile?.role === "admin" && <Button label="Admin" onPress={() => { setAdminOpen(true); void loadAdminEvents(); }} />}
        </View>
      </View>
      <FlatList
        data={visibleEvents}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadEvents(); setRefreshing(false); }} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            <Text style={styles.eyebrow}>WAS GEHT WO?</Text>
            <Text style={styles.heading}>Deine Events,{"\n"}endlich an einem Ort.</Text>
            <Text style={styles.intro}>Entdecke Partys, Konzerte, Szeneangebote und ruhige Events in Erfurt und Umgebung.</Text>
            <TextInput value={query} onChangeText={setQuery} placeholder="Events durchsuchen" placeholderTextColor={colors.muted} style={styles.search} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {genreOptions.map((option) => <Pressable key={option.value} onPress={() => setGenre(option.value)} style={[styles.chip, genre === option.value && styles.chipActive]}><Text style={styles.chipText}>{option.label}</Text></Pressable>)}
              <Pressable onPress={() => setPlace(place === "nearby" ? "all" : "nearby")} style={[styles.chip, place === "nearby" && styles.chipActive]}><Text style={styles.chipText}>Umgebung</Text></Pressable>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {([["all", "Alle Tage"], ["today", "Heute"], ["weekend", "Dieses Wochenende"], ["week", "Diese Woche"]] as const).map(([value, label]) => <Pressable key={value} onPress={() => { setDateGroup(value); setDateStart(""); setDateEnd(""); }} style={[styles.chip, dateGroup === value && styles.chipActive]}><Text style={styles.chipText}>{label}</Text></Pressable>)}
              <Pressable onPress={() => setDateGroup("custom")} style={[styles.chip, dateGroup === "custom" && styles.chipActive]}><Text style={styles.chipText}>Datum / Zeitraum</Text></Pressable>
              <Pressable onPress={surprise} style={styles.surpriseChip}><Text style={styles.chipText}>Überrasche mich ↗</Text></Pressable>
            </ScrollView>
            {dateGroup === "custom" && <View style={styles.dateRange}>
              <TextInput value={dateStart} onChangeText={setDateStart} placeholder="Start: JJJJ-MM-TT" placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} keyboardType="numbers-and-punctuation" />
              <TextInput value={dateEnd} onChangeText={setDateEnd} placeholder="Ende (optional)" placeholderTextColor={colors.muted} style={[styles.input, styles.dateInput]} keyboardType="numbers-and-punctuation" />
            </View>}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{filteredEvents.length > visibleEvents.length ? `${visibleEvents.length} von ${filteredEvents.length}` : filteredEvents.length} Veranstaltungen</Text><Text style={styles.city}>Erfurt</Text></View>
          </View>
        }
        renderItem={({ item }) => <EventCard event={item} onPress={() => setSelected(item)} />}
        ListEmptyComponent={<Text style={styles.empty}>Keine passenden Events gefunden.</Text>}
        ListFooterComponent={visibleEvents.length < filteredEvents.length ? <View style={styles.loadMore}><Button label="Mehr anzeigen" secondary onPress={() => setVisibleEventLimit((limit) => limit + 12)} /></View> : null}
      />
      <View style={styles.organizerBar}>
        <View style={styles.organizerCopy}><Text style={styles.organizerTitle}>Dein Event. Deine Leute.</Text><Text style={styles.organizerText}>Reiche dein Event direkt in der App ein.</Text></View>
        <Button label="Event eintragen" onPress={() => { if (!sessionEmail) setAuthOpen(true); else setOrganizerOpen(true); }} />
      </View>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Pressable onPress={() => setSelected(null)}><Text style={styles.close}>×</Text></Pressable>
          {selected?.image_url && <Image source={{ uri: selected.image_url }} style={styles.detailImage} resizeMode="cover" />}
          <Text style={styles.eyebrow}>{selected?.type}</Text><Text style={styles.modalTitle}>{selected?.title}</Text>
          <Text style={styles.modalMeta}>{selected && formatDate(selected.starts_at)} · {selected?.venue} · {selected?.price}</Text>
          <Text style={styles.description}>{selected?.description || "Weitere Informationen findest du bei der Originalquelle."}</Text>
          <Button label="Schließen" onPress={() => setSelected(null)} secondary />
        </View></View>
      </Modal>

      <Modal visible={authOpen} transparent animationType="slide" onRequestClose={() => setAuthOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Pressable onPress={() => setAuthOpen(false)}><Text style={styles.close}>×</Text></Pressable>
          <Text style={styles.eyebrow}>WASGEHT ACCOUNT</Text><Text style={styles.modalTitle}>{authMode === "login" ? "Schön, dass du da bist." : "Account erstellen"}</Text>
          <TextInput autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="E-Mail" placeholderTextColor={colors.muted} style={styles.input} />
          <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Passwort" placeholderTextColor={colors.muted} style={styles.input} />
          {!!authMessage && <Text style={styles.message}>{authMessage}</Text>}
          <Button label={authBusy ? "Bitte warten …" : authMode === "login" ? "Anmelden" : "Registrieren"} onPress={() => void authenticate()} />
          <Button label={authMode === "login" ? "Account erstellen" : "Zum Login"} secondary onPress={() => setAuthMode(authMode === "login" ? "register" : "login")} />
        </View></KeyboardAvoidingView>
      </Modal>

      <Modal visible={organizerOpen || adminOpen} transparent animationType="slide" onRequestClose={() => { setOrganizerOpen(false); setAdminOpen(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}><ScrollView style={styles.modalCard}>
          <Pressable onPress={() => { setOrganizerOpen(false); setAdminOpen(false); }}><Text style={styles.close}>×</Text></Pressable>
          <Text style={styles.eyebrow}>{adminOpen ? "ADMIN / VERWALTUNG" : "VERANSTALTER"}</Text>
          <Text style={styles.modalTitle}>{adminOpen ? "Events verwalten" : "Event eintragen"}</Text>
          {!adminOpen && <>
            <TextInput value={newEventTitle} onChangeText={setNewEventTitle} placeholder="Eventtitel" placeholderTextColor={colors.muted} style={styles.input} />
            <TextInput value={newEventVenue} onChangeText={setNewEventVenue} placeholder="Location" placeholderTextColor={colors.muted} style={styles.input} />
            <TextInput value={newEventDate} onChangeText={setNewEventDate} placeholder="Datum, z. B. 2026-12-24T20:00" placeholderTextColor={colors.muted} style={styles.input} />
            <Button label="Event einreichen" onPress={() => void createEvent()} />
          </>}
          {adminOpen && adminEvents.map((event) => <View key={event.id} style={styles.adminRow}><View style={{ flex: 1 }}><Text style={styles.adminTitle}>{event.title}</Text><Text style={styles.cardMeta}>{event.venue} · {formatDate(event.starts_at)} · {event.is_public ? "veröffentlicht" : "Prüfung"}</Text></View><Button label={event.is_public ? "Ausblenden" : "Freigeben"} secondary onPress={() => void updateEventVisibility(event)} /><Button label="Löschen" secondary onPress={() => deleteEvent(event)} /></View>)}
        </ScrollView></KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  logo: { width: 145, height: 54 },
  headerActions: { flexDirection: "row", gap: 8 },
  content: { padding: 20, paddingBottom: 120 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 },
  heading: { color: colors.ink, fontSize: 42, fontWeight: "900", lineHeight: 40, letterSpacing: -2 },
  intro: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 18, marginBottom: 20, maxWidth: 430 },
  search: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 18, color: colors.ink, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15 },
  chips: { gap: 8, paddingVertical: 14 },
  chip: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: colors.accent },
  surpriseChip: { backgroundColor: colors.pink, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  city: { color: colors.muted, fontSize: 13 },
  gridRow: { gap: 12 },
  card: { flex: 1, minWidth: 0, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 22, overflow: "hidden", marginBottom: 12 },
  cardPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  poster: { height: 170, margin: 7, borderRadius: 17, justifyContent: "center", alignItems: "center", overflow: "hidden" },
  posterImage: { ...StyleSheet.absoluteFillObject },
  posterText: { color: "#fff7fb", fontSize: 21, fontWeight: "900", textAlign: "center", padding: 12 },
  posterDate: { position: "absolute", bottom: 8, right: 8, color: colors.ink, backgroundColor: "rgba(45,43,48,.85)", borderRadius: 99, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10, fontWeight: "800" },
  cardContent: { padding: 10, paddingTop: 5 },
  tag: { color: colors.pink, fontSize: 10, fontWeight: "800", textTransform: "uppercase", marginBottom: 5 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: "800", lineHeight: 19 },
  cardMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 7 },
  price: { color: colors.accent, fontSize: 11, fontWeight: "800", marginTop: 8 },
  empty: { color: colors.muted, paddingVertical: 40, textAlign: "center" },
  loadMore: { alignItems: "center", paddingVertical: 18 },
  organizerBar: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: "rgba(61,56,65,.96)", borderColor: colors.border, borderWidth: 1, borderRadius: 22, padding: 14 },
  organizerCopy: { flex: 1 },
  organizerTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  organizerText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  button: { minHeight: 40, borderRadius: 999, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 15 },
  buttonText: { color: "#2d2b30", fontSize: 12, fontWeight: "800" },
  secondaryButton: { backgroundColor: colors.panelStrong, borderColor: colors.border, borderWidth: 1 },
  secondaryButtonText: { color: colors.ink },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(15,13,17,.72)", justifyContent: "flex-end" },
  modalCard: { maxHeight: "92%", backgroundColor: colors.panelStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 },
  close: { color: colors.ink, fontSize: 30, textAlign: "right", marginBottom: 4 },
  detailImage: { width: "100%", height: 190, borderRadius: 18, marginBottom: 18 },
  modalTitle: { color: colors.ink, fontSize: 30, fontWeight: "900", letterSpacing: -1, marginBottom: 10 },
  modalMeta: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  description: { color: colors.ink, fontSize: 14, lineHeight: 22, marginBottom: 22 },
  input: { color: colors.ink, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 11 },
  dateRange: { flexDirection: "row", gap: 8, marginBottom: 5 },
  dateInput: { flex: 1, minWidth: 0 },
  message: { color: colors.pink, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  adminRow: { flexDirection: "row", alignItems: "center", gap: 10, borderColor: colors.border, borderBottomWidth: 1, paddingVertical: 12 },
  adminTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }
});
