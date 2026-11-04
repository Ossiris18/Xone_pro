import { useEffect, useMemo, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../../config/firebase";
import {
  doc,
  onSnapshot,
  runTransaction,
  collection,
  query,
  where,
  serverTimestamp,
  increment,
  getDocs,
} from "firebase/firestore";
import { colors } from "../../constants/theme";
import { prepararEnvioComprobante, getSucursalById, getUsuarioPorUid } from "../../services/apiServices";
import { validarCurpMatematica, validarTelefono } from "../../utilities/validaciones";

const PASOS = ["Voucher", "Peticiones", "Huésped", "Pago"];

const getImageSource = (fotoUrl) => {
  if (!fotoUrl) return null;
  return { uri: fotoUrl };
};

const obtenerFechaLocalISO = (dateObj) => {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return "";
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
};

const formatDate = (dateValue) => {
  if (!dateValue) return "Por definir";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "Por definir";
  return parsed.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
};

export default function CheckoutScreen({ navigation, route }) {
  const { hotel, habitacion, tipoCategoria } = route.params || {};
  const categoriaObjetivo = tipoCategoria || habitacion?.tipo || "Tradicional";

  const [step, setStep] = useState(1);
  const [mensajeEspecial, setMensajeEspecial] = useState("");
  const [nombreTitular, setNombreTitular] = useState(auth.currentUser?.displayName || "");
  const [curp, setCurp] = useState("");
  const [telefono, setTelefono] = useState("");
  const [fechaEntradaDate, setFechaEntradaDate] = useState(new Date());
  const [fechaSalidaDate, setFechaSalidaDate] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [showCheckInPicker, setShowCheckInPicker] = useState(false);
  const [showCheckOutPicker, setShowCheckOutPicker] = useState(false);
  const [metodoPago, setMetodoPago] = useState("card");
  const [numeroTarjeta, setNumeroTarjeta] = useState("");
  const [vencimiento, setVencimiento] = useState("");
  const [cvv, setCvv] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [habitacionConfirmadaNum, setHabitacionConfirmadaNum] = useState(habitacion?.numero || "");
  const [comprobanteInfo, setComprobanteInfo] = useState(null);
  const [tieneDatosPrevios, setTieneDatosPrevios] = useState(false);
  const [modalTerminos, setModalTerminos] = useState(false);
  const [modalPrivacidad, setModalPrivacidad] = useState(false);
  const [habitacionInterceptada, setHabitacionInterceptada] = useState(false);

  // Pool de habitaciones de esta categoría y reservas activas del hotel en tiempo real
  const [poolCategoria, setPoolCategoria] = useState([]);
  const [reservasActivasHotel, setReservasActivasHotel] = useState([]);
  const unsubscribePoolRef = useRef(null);
  const unsubscribeResRef = useRef(null);

  const user = auth.currentUser;

  const noches = useMemo(() => {
    const inicio = new Date(fechaEntradaDate).setHours(0, 0, 0, 0);
    const fin = new Date(fechaSalidaDate).setHours(0, 0, 0, 0);
    if (Number.isNaN(inicio) || Number.isNaN(fin) || fin <= inicio) return 1;
    return Math.max(1, Math.ceil((fin - inicio) / (24 * 60 * 60 * 1000)));
  }, [fechaEntradaDate, fechaSalidaDate]);

  const subtotal = useMemo(() => Number(habitacion?.precioBase || 0) * noches, [habitacion, noches]);
  const impuestos = useMemo(() => subtotal * 0.16, [subtotal]);
  const total = useMemo(() => subtotal + impuestos, [subtotal, impuestos]);

  const telefonoValido = validarTelefono(telefono);
  const curpValida = validarCurpMatematica(curp);
  const nombreValido = nombreTitular.trim().length >= 3;
  const tarjetaValida = /^\d{16}$/.test(numeroTarjeta);
  const vencimientoValido = /^(0[1-9]|1[0-2])\/(\d{2})$/.test(vencimiento);
  const cvvValido = /^\d{3,4}$/.test(cvv);
  const pagoValido = metodoPago === "paypal" || (tarjetaValida && vencimientoValido && cvvValido);

  const entradaISO = useMemo(() => obtenerFechaLocalISO(fechaEntradaDate), [fechaEntradaDate]);
  const salidaISO = useMemo(() => obtenerFechaLocalISO(fechaSalidaDate), [fechaSalidaDate]);

  // 🛡️ ROOM POOLING & ESCUCHA EN TIEMPO REAL DE RESERVAS POR FECHAS
  useEffect(() => {
    if (!hotel?.id) return;

    const qHabs = query(
      collection(db, "Habitaciones"),
      where("idSucursal", "==", hotel.id),
      where("tipo", "==", categoriaObjetivo)
    );

    const unsubHabs = onSnapshot(qHabs, (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }));
      setPoolCategoria(docs);
    });

    const qRes = query(
      collection(db, "Reservas"),
      where("idSucursal", "==", hotel.id),
      where("estado", "==", "Activa")
    );

    const unsubRes = onSnapshot(qRes, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setReservasActivasHotel(docs);
    });

    unsubscribePoolRef.current = unsubHabs;
    unsubscribeResRef.current = unsubRes;

    return () => {
      unsubHabs();
      unsubRes();
    };
  }, [hotel?.id, categoriaObjetivo]);

  // Calcular qué habitaciones de esta categoría están libres para el rango de fechas elegido [entradaISO, salidaISO]
  // NOTA CLAVE: No filtramos por hab.estado === 'disponible' estático de hoy, porque si está ocupada del 3 al 4 de nov,
  // SÍ está disponible para reservar del 4 al 6 de nov o en cualquier otro mes.
  const habitacionesLibresEnFechas = useMemo(() => {
    return poolCategoria.filter((hab) => {
      // 1. Verificar si el estado directo en el documento de la habitación tiene fechas que choquen con [entradaISO, salidaISO]
      if (hab.estado === "ocupado" && hab.fechaEntrada && hab.fechaSalida) {
        const chocaConActual = entradaISO < hab.fechaSalida && salidaISO > hab.fechaEntrada;
        if (chocaConActual) return false;
      }

      // 2. Verificar contra todas las reservas activas de esa habitación en Firestore
      const tieneChoqueReserva = reservasActivasHotel.some((res) => {
        if (res.idHabitacion !== hab.id) return false;
        if (!res.fechaEntrada || !res.fechaSalida) return false;
        // Regla hotelera: Check-out es a las 12:00 hrs y Check-in a las 15:00 hrs.
        // Si res.fechaSalida === "2026-11-04" y la nueva entradaISO === "2026-11-04", NO hay choque.
        return entradaISO < res.fechaSalida && salidaISO > res.fechaEntrada;
      });

      return !tieneChoqueReserva;
    });
  }, [poolCategoria, reservasActivasHotel, entradaISO, salidaISO]);

  // Mostrar al usuario qué rangos de fechas están ocupados en esta categoría para orientarlo en el calendario
  const periodosOcupadosCategoria = useMemo(() => {
    if (poolCategoria.length === 0) return [];
    const idsCategoria = new Set(poolCategoria.map((h) => h.id));
    const reservasDeCategoria = reservasActivasHotel.filter(
      (r) => idsCategoria.has(r.idHabitacion) && r.fechaEntrada && r.fechaSalida
    );
    return reservasDeCategoria.map((r) => ({
      id: r.id,
      numeroHabitacion: r.numeroHabitacion,
      entrada: r.fechaEntrada,
      salida: r.fechaSalida,
    }));
  }, [poolCategoria, reservasActivasHotel]);

  // Si el usuario ya avanzó al paso 2, 3 o 4 con fechas elegidas y en ese instante alguien ocupa la última habitación para esas fechas
  useEffect(() => {
    if (step > 1 && poolCategoria.length > 0 && habitacionesLibresEnFechas.length === 0 && !loading && !success) {
      setHabitacionInterceptada(true);
    }
  }, [step, poolCategoria.length, habitacionesLibresEnFechas.length, loading, success]);

  // Precargar nombre real, CURP y teléfono del usuario desde Firestore
  useEffect(() => {
    const precargarDatos = async () => {
      if (user?.uid) {
        const datos = await getUsuarioPorUid(user.uid);
        if (datos?.nombre) {
          setNombreTitular(datos.nombre);
        } else if (user?.displayName) {
          setNombreTitular(user.displayName);
        }
        if (datos?.curp) {
          setCurp(datos.curp);
        }
        if (datos?.telefono) {
          setTelefono(datos.telefono);
        }
        if (datos?.curp && datos?.telefono) {
          setTieneDatosPrevios(true);
        }
      }
    };
    precargarDatos();
  }, [user?.uid, user?.displayName]);

  const onChangeCheckIn = (event, selectedDate) => {
    if (Platform.OS !== "ios") setShowCheckInPicker(false);
    if (!selectedDate) return;
    setFechaEntradaDate(selectedDate);
    if (selectedDate >= fechaSalidaDate) {
      setFechaSalidaDate(new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000));
    }
  };

  const onChangeCheckOut = (event, selectedDate) => {
    if (Platform.OS !== "ios") setShowCheckOutPicker(false);
    if (!selectedDate) return;
    const checkOut = new Date(selectedDate);
    if (checkOut <= fechaEntradaDate) {
      Alert.alert("Fecha inválida", "La fecha de check-out debe ser posterior al check-in.");
      return;
    }
    setFechaSalidaDate(checkOut);
  };

  if (!hotel || !habitacion) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <Text style={styles.errorText}>No hay información de reserva.</Text>
      </SafeAreaView>
    );
  }

  const goNext = () => {
    if (habitacionesLibresEnFechas.length === 0) {
      Alert.alert(
        "Fechas ocupadas",
        `Todas las habitaciones ${categoriaObjetivo} están reservadas del ${entradaISO} al ${salidaISO}. Selecciona otros días libres en el calendario.`
      );
      return;
    }
    if (step === 3 && (!nombreValido || !telefonoValido || !curpValida)) {
      Alert.alert("Datos inválidos", "Verifica tu nombre completo, teléfono de 10 dígitos y CURP de 18 caracteres.");
      return;
    }
    if (step === 4 && !pagoValido) {
      Alert.alert("Pago incompleto", "Completa correctamente los datos del método de pago.");
      return;
    }
    setStep((prev) => Math.min(4, prev + 1));
  };

  // 🛡️ TRANSACCIÓN ATÓMICA CON ASIGNACIÓN DINÁMICA POR FECHAS
  const onConfirm = async () => {
    if (habitacionInterceptada || habitacionesLibresEnFechas.length === 0) {
      setHabitacionInterceptada(true);
      return;
    }
    if (!nombreValido || !telefonoValido || !curpValida) {
      Alert.alert("Datos inválidos", "Ingresa tu nombre, teléfono de 10 dígitos y una CURP válida.");
      return;
    }
    if (!pagoValido) {
      Alert.alert("Pago incompleto", "Completa correctamente los datos del método de pago.");
      return;
    }

    setLoading(true);
    try {
      if (unsubscribePoolRef.current) unsubscribePoolRef.current();
      if (unsubscribeResRef.current) unsubscribeResRef.current();

      const reservasRef = collection(db, "Reservas");
      const curpLimpia = curp.trim().toUpperCase();
      const telLimpio = telefono.trim();
      const correoLimpio = String(user?.email || "").trim().toLowerCase();
      const nombreFinal = nombreTitular.trim() || user?.displayName || "Huésped";
      const totalFinal = Number(total.toFixed(2)) || Number(habitacion?.precioBase || 0);
      const hoyISO = obtenerFechaLocalISO(new Date());

      const hotelCompleto = await getSucursalById(hotel.id);

      // Consultar las reservas activas más recientes de la sucursal justo antes de la transacción
      const snapResFrescas = await getDocs(
        query(
          collection(db, "Reservas"),
          where("idSucursal", "==", hotel.id),
          where("estado", "==", "Activa")
        )
      );
      const reservasFrescas = snapResFrescas.docs.map((d) => ({ id: d.id, ...d.data() }));

      let habAsignadaFinal = null;

      await runTransaction(db, async (transaction) => {
        let habElegida = null;

        for (const candidata of habitacionesLibresEnFechas) {
          const refCandidata = doc(db, "Habitaciones", candidata.id);
          const snapCandidata = await transaction.get(refCandidata);
          if (!snapCandidata.exists()) continue;

          const dataHab = snapCandidata.data();

          // Verificar que nadie acaba de ocupar esta habitación en un rango que choque con [entradaISO, salidaISO]
          const chocaConEstadoActual =
            dataHab.estado === "ocupado" &&
            dataHab.fechaEntrada &&
            dataHab.fechaSalida &&
            entradaISO < dataHab.fechaSalida &&
            salidaISO > dataHab.fechaEntrada;

          const chocaConReservaActiva = reservasFrescas.some(
            (r) =>
              r.idHabitacion === snapCandidata.id &&
              r.fechaEntrada &&
              r.fechaSalida &&
              entradaISO < r.fechaSalida &&
              salidaISO > r.fechaEntrada
          );

          if (!chocaConEstadoActual && !chocaConReservaActiva) {
            habElegida = { id: snapCandidata.id, ...dataHab, ref: refCandidata };
            break;
          }
        }

        if (!habElegida) {
          throw new Error("INTERCEPTADA");
        }

        habAsignadaFinal = habElegida;

        // 1. Si la reserva inicia HOY, marcamos la habitación como ocupada hoy;
        // si es para fechas futuras (ej. del 4 al 6 de nov y hoy es 3), se mantiene disponible hoy o con su ocupante de hoy.
        if (entradaISO <= hoyISO && salidaISO > hoyISO) {
          transaction.update(habElegida.ref, {
            estado: "ocupado",
            huespedNombre: nombreFinal,
            huespedID: curpLimpia,
            fechaEntrada: entradaISO,
            fechaSalida: salidaISO,
            totalActual: totalFinal,
            fechaIngreso: serverTimestamp(),
          });
        }

        // 2. Actualizar perfil del usuario con su nombre real, CURP y correo siempre asociados
        if (user?.uid) {
          const usuarioUidRef = doc(db, "Usuarios", user.uid);
          transaction.set(
            usuarioUidRef,
            {
              uid: user.uid,
              nombre: nombreFinal,
              correo: correoLimpio,
              curp: curpLimpia,
              telefono: telLimpio,
              ultimaVisita: serverTimestamp(),
              totalEstancias: increment(1),
            },
            { merge: true }
          );
        }

        // 3. Crear documento en Reservas vinculando CURP, UID y Correo
        const nuevaReservaRef = doc(reservasRef);
        transaction.set(nuevaReservaRef, {
          idSucursal: hotelCompleto?.id || hotel.id,
          idHabitacion: habElegida.id,
          numeroHabitacion: habElegida.numero || "",
          tipoHabitacion: categoriaObjetivo,
          idUsuario: curpLimpia,
          uidUsuario: user?.uid || "",
          correoUsuario: correoLimpio,
          nombreUsuario: nombreFinal,
          huespedNombre: nombreFinal,
          estado: "Activa",
          totalGenerado: totalFinal,
          fechaIngreso: serverTimestamp(),
          fechaEntrada: entradaISO,
          fechaSalida: salidaISO,
          horaCheckIn: "15:00 hrs",
          horaCheckOut: "12:00 hrs",
          mensajeEspecial: mensajeEspecial || "",
          metodoPago: metodoPago === "paypal" ? "PayPal" : "Tarjeta de Crédito/Débito",
          ultimos4Tarjeta: metodoPago === "card" ? numeroTarjeta.slice(-4) : "",
          estadoComprobante: "enviado",
        });

        // 4. Registrar en Bitácora de Auditoría
        const bitacoraRef = doc(collection(db, "Bitacora"));
        transaction.set(bitacoraRef, {
          tipoAccion: "CREACIÓN",
          nombreEmpleado: `${nombreFinal} (App Móvil)`,
          rolEmpleado: "Huésped",
          detalles: `Reserva móvil: Habitación #${habElegida.numero} (${categoriaObjetivo}) del ${entradaISO} al ${salidaISO} en ${hotelCompleto?.nombre || hotel.nombre} | CURP: ${curpLimpia}`,
          fecha: serverTimestamp(),
        });
      });

      setHabitacionConfirmadaNum(habAsignadaFinal?.numero || habitacion.numero);

      const comprobante = await prepararEnvioComprobante({
        correoDestino: user?.email || "",
        plantilla: {
          nombreUsuario: nombreFinal,
          hotel: hotelCompleto?.nombre || hotel?.nombre || "Hotel",
          habitacion: `${categoriaObjetivo} #${habAsignadaFinal?.numero || habitacion?.numero || "-"}`,
          numeroHabitacion: String(habAsignadaFinal?.numero || habitacion?.numero || "-"),
          pais: hotelCompleto?.ubicacion?.pais || hotel?.ubicacion?.pais || "México",
          municipio: hotelCompleto?.ubicacion?.municipio || hotel?.ubicacion?.municipio || "No especificado",
          direccion: hotelCompleto?.ubicacion?.direccion || hotel?.ubicacion?.direccion || "No especificada",
          total: totalFinal,
          fechaEntrada: `${formatDate(fechaEntradaDate)} (15:00 hrs)`,
          fechaSalida: `${formatDate(fechaSalidaDate)} (12:00 hrs)`,
          metodoPago: metodoPago === "paypal" ? "PayPal" : "Tarjeta de Crédito/Débito",
          ultimos4: metodoPago === "card" ? numeroTarjeta.slice(-4) : "",
        },
      });

      setComprobanteInfo(comprobante);
      setSuccess(true);
    } catch (error) {
      if (error.message === "INTERCEPTADA") {
        setHabitacionInterceptada(true);
      } else {
        Alert.alert("Error", "No se pudo confirmar la reserva. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={styles.centeredScreen}>
        <View style={styles.successCard}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark" size={40} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>¡Reserva Confirmada!</Text>
          <Text style={styles.successText}>
            Se te asignó la Habitación #{habitacionConfirmadaNum} ({categoriaObjetivo}) en {hotel.nombre}.
          </Text>
          <View style={styles.receiptMiniBox}>
            <Text style={styles.receiptMiniLine}>Huésped: {nombreTitular}</Text>
            <Text style={styles.receiptMiniLine}>Check-in: {formatDate(fechaEntradaDate)} a las 15:00 hrs</Text>
            <Text style={styles.receiptMiniLine}>Check-out: {formatDate(fechaSalidaDate)} a las 12:00 hrs</Text>
            <Text style={styles.receiptMiniTotal}>Total pagado: ${total.toFixed(2)} MXN</Text>
          </View>
          <Text style={styles.mailText}>
            Comprobante digital: {comprobanteInfo?.status === "enviado" ? `Enviado a ${user?.email}` : "Disponible en Mis Viajes"}
          </Text>
          <Pressable
            style={[styles.primaryButton, { width: "100%", marginTop: 8 }]}
            onPress={() => navigation.navigate("Main", { screen: "Mis Viajes" })}
          >
            <Text style={styles.primaryButtonText}>Ver en Mis Viajes</Text>
          </Pressable>
          <Pressable
            style={{ paddingVertical: 8 }}
            onPress={() => navigation.navigate("Main", { screen: "Explorar" })}
          >
            <Text style={{ color: colors.textSecondary, fontWeight: "700", fontSize: 14 }}>Volver a Explorar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backIconBtn}
          onPress={() => (step > 1 ? setStep(step - 1) : navigation.goBack())}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Confirmar Reserva</Text>
          <Text style={styles.stepText}>Paso {step} de 4 — {PASOS[step - 1]}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.stepsRow}>
          {PASOS.map((label, index) => {
            const stepIndex = index + 1;
            const active = step === stepIndex;
            const done = step > stepIndex;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? (
                    <Ionicons name="checkmark" size={14} color={colors.textLight} />
                  ) : (
                    <Text style={[styles.stepDotText, active && styles.stepDotTextActive]}>{stepIndex}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && { color: colors.primary, fontWeight: "700" }]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {step === 1 && (
          <View style={styles.ticketCard}>
            <Text style={styles.ticketTitle}>Resumen de tu estancia</Text>
            {habitacion?.fotoUrl ? (
              <Image source={getImageSource(habitacion.fotoUrl)} style={styles.roomImage} />
            ) : hotel?.fotoUrl ? (
              <Image source={getImageSource(hotel.fotoUrl)} style={styles.roomImage} />
            ) : (
              <View style={[styles.roomImage, styles.imagePlaceholder]}>
                <Ionicons name="bed-outline" size={36} color={colors.textSecondary} />
              </View>
            )}
            <Text style={styles.hotelTitleCard}>{hotel.nombre || "-"}</Text>
            <Text style={styles.ticketLine}>Categoría: Habitación {categoriaObjetivo}</Text>

            {/* INDICADOR DE DISPONIBILIDAD EN VIVO POR CATEGORÍA Y FECHAS */}
            <View style={[
              styles.availabilityBanner,
              habitacionesLibresEnFechas.length > 0 ? styles.availabilityBannerOk : styles.availabilityBannerEmpty
            ]}>
              <Ionicons
                name={habitacionesLibresEnFechas.length > 0 ? "checkmark-circle" : "close-circle"}
                size={18}
                color={habitacionesLibresEnFechas.length > 0 ? colors.success : colors.error}
              />
              <Text style={[
                styles.availabilityBannerText,
                { color: habitacionesLibresEnFechas.length > 0 ? "#166534" : "#991b1b" }
              ]}>
                {habitacionesLibresEnFechas.length > 0
                  ? `${habitacionesLibresEnFechas.length} de ${poolCategoria.length || 1} habitación(es) ${categoriaObjetivo} libre(s) del ${entradaISO} al ${salidaISO}`
                  : `Todas las habitaciones ${categoriaObjetivo} están ocupadas del ${entradaISO} al ${salidaISO}. Elige otras fechas abajo.`}
              </Text>
            </View>

            {periodosOcupadosCategoria.length > 0 && (
              <View style={styles.occupiedDatesBox}>
                <Text style={styles.occupiedDatesTitle}>
                  Ocupación registrada en {categoriaObjetivo} (Check-out 12:00 hrs libera ese mismo día a las 15:00 hrs):
                </Text>
                {periodosOcupadosCategoria.slice(0, 4).map((p) => (
                  <Text key={p.id} style={styles.occupiedDatesItem}>
                    • Hab. #{p.numeroHabitacion}: ocupada del {p.entrada} (15:00h) al {p.salida} (12:00h)
                  </Text>
                ))}
              </View>
            )}

            <View style={styles.dateRow}>
              <Pressable style={styles.datePickerButton} onPress={() => setShowCheckInPicker(true)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                  <Text style={styles.datePickerLabel}>LLEGADA (15:00 HRS)</Text>
                </View>
                <Text style={styles.datePickerValue}>{formatDate(fechaEntradaDate)}</Text>
              </Pressable>
              <Pressable style={styles.datePickerButton} onPress={() => setShowCheckOutPicker(true)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="calendar-outline" size={14} color={colors.primary} />
                  <Text style={styles.datePickerLabel}>SALIDA (12:00 HRS)</Text>
                </View>
                <Text style={styles.datePickerValue}>{formatDate(fechaSalidaDate)}</Text>
              </Pressable>
            </View>

            {showCheckInPicker && (
              <DateTimePicker
                value={fechaEntradaDate}
                mode="date"
                minimumDate={new Date()}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={onChangeCheckIn}
              />
            )}
            {showCheckOutPicker && (
              <DateTimePicker
                value={fechaSalidaDate}
                mode="date"
                minimumDate={new Date(fechaEntradaDate.getTime() + 24 * 60 * 60 * 1000)}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={onChangeCheckOut}
              />
            )}

            <View style={styles.totalBox}>
              <View style={styles.priceLineRow}>
                <Text style={styles.ticketLine}>${Number(habitacion.precioBase || 0).toLocaleString()} MXN x {noches} {noches === 1 ? "noche" : "noches"}</Text>
                <Text style={styles.ticketLine}>${subtotal.toFixed(2)} MXN</Text>
              </View>
              <View style={styles.priceLineRow}>
                <Text style={styles.ticketLine}>Impuestos y cargos (16% IVA)</Text>
                <Text style={styles.ticketLine}>${impuestos.toFixed(2)} MXN</Text>
              </View>
              <View style={[styles.priceLineRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }]}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>Total (MXN)</Text>
                <Text style={styles.ticketTotal}>${total.toFixed(2)}</Text>
              </View>
            </View>
          </View>
        )}

        {step === 2 && (
          <View style={styles.ticketCard}>
            <Text style={styles.ticketTitle}>Peticiones especiales</Text>
            <Text style={styles.helperText}>
              Comparte al hotel si necesitas llegada anticipada, piso alto o alguna amenidad adicional.
            </Text>
            <TextInput
              placeholder="Ej. Llegada después de las 20:00 hrs, almohadas extra..."
              placeholderTextColor={colors.textSecondary}
              multiline
              value={mensajeEspecial}
              onChangeText={setMensajeEspecial}
              style={[styles.input, styles.textArea]}
            />
          </View>
        )}

        {step === 3 && (
          <View style={styles.ticketCard}>
            <Text style={styles.ticketTitle}>Identificación del huésped titular</Text>

            <Text style={styles.fieldLabel}>Nombre completo del titular</Text>
            <TextInput
              placeholder="Nombre y Apellidos"
              placeholderTextColor={colors.textSecondary}
              value={nombreTitular}
              onChangeText={setNombreTitular}
              style={[styles.input, !nombreValido && styles.inputError]}
            />

            <Text style={styles.fieldLabel}>CURP Oficial (18 caracteres)</Text>
            <TextInput
              placeholder="XXXX000000HXXXXX00"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              value={curp}
              maxLength={18}
              onChangeText={(text) => setCurp(text.toUpperCase().replace(/\s+/g, ""))}
              style={[
                styles.input,
                curp.length > 0 && !curpValida && styles.inputError,
              ]}
            />

            <Text style={styles.fieldLabel}>Teléfono de contacto (10 dígitos)</Text>
            <TextInput
              placeholder="9610000000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
              value={telefono}
              maxLength={10}
              onChangeText={(text) => setTelefono(text.replace(/\D/g, ""))}
              style={[
                styles.input,
                telefono.length > 0 && !telefonoValido && styles.inputError,
              ]}
            />

            <View style={{ flexDirection: "row", gap: 14, marginTop: 2 }}>
              <Text style={[styles.helperText, { color: curpValida ? colors.success : colors.textSecondary, fontWeight: "600" }]}>
                {curpValida ? "✓ CURP verificada" : "• CURP de 18 caracteres"}
              </Text>
              <Text style={[styles.helperText, { color: telefonoValido ? colors.success : colors.textSecondary, fontWeight: "600" }]}>
                {telefonoValido ? "✓ Teléfono válido" : "• Teléfono a 10 dígitos"}
              </Text>
            </View>

            {!tieneDatosPrevios && (
              <View style={styles.terminosContainer}>
                <Text style={styles.terminosText}>
                  Al continuar, acepto los{" "}
                  <Text style={styles.terminosLink} onPress={() => setModalTerminos(true)}>
                    Términos y Condiciones
                  </Text>{" "}
                  y el{" "}
                  <Text style={styles.terminosLink} onPress={() => setModalPrivacidad(true)}>
                    Aviso de Privacidad
                  </Text>
                </Text>
              </View>
            )}
          </View>
        )}

        {step === 4 && (
          <View style={styles.ticketCard}>
            <Text style={styles.ticketTitle}>Método de pago seguro</Text>
            <View style={styles.paymentSwitchRow}>
              <Pressable
                style={[styles.paymentOption, metodoPago === "card" && styles.paymentOptionActive]}
                onPress={() => setMetodoPago("card")}
              >
                <Ionicons name="card-outline" size={18} color={metodoPago === "card" ? colors.primaryDark : colors.textSecondary} />
                <Text style={[styles.paymentOptionText, metodoPago === "card" && styles.paymentOptionTextActive]}>
                  Tarjeta Bancaria
                </Text>
              </Pressable>
              <Pressable
                style={[styles.paymentOption, metodoPago === "paypal" && styles.paymentOptionActive]}
                onPress={() => setMetodoPago("paypal")}
              >
                <Ionicons name="logo-paypal" size={18} color={metodoPago === "paypal" ? colors.primaryDark : colors.textSecondary} />
                <Text style={[styles.paymentOptionText, metodoPago === "paypal" && styles.paymentOptionTextActive]}>
                  PayPal
                </Text>
              </Pressable>
            </View>
            {metodoPago === "card" ? (
              <>
                <TextInput
                  placeholder="Número de tarjeta (16 dígitos)"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  maxLength={16}
                  value={numeroTarjeta}
                  onChangeText={(text) => setNumeroTarjeta(text.replace(/\D/g, ""))}
                  style={[styles.input, numeroTarjeta.length > 0 && !tarjetaValida && styles.inputError]}
                />
                <View style={styles.cardRow}>
                  <TextInput
                    placeholder="MM/AA"
                    placeholderTextColor={colors.textSecondary}
                    maxLength={5}
                    keyboardType="numeric"
                    value={vencimiento}
                    onChangeText={(text) => {
                      const onlyDigits = text.replace(/\D/g, "").slice(0, 4);
                      const formatted = onlyDigits.length > 2 ? `${onlyDigits.slice(0, 2)}/${onlyDigits.slice(2)}` : onlyDigits;
                      setVencimiento(formatted);
                    }}
                    style={[styles.input, styles.cardHalfInput, vencimiento.length > 0 && !vencimientoValido && styles.inputError]}
                  />
                  <TextInput
                    placeholder="CVV"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={4}
                    value={cvv}
                    onChangeText={(text) => setCvv(text.replace(/\D/g, ""))}
                    style={[styles.input, styles.cardHalfInput, cvv.length > 0 && !cvvValido && styles.inputError]}
                  />
                </View>
              </>
            ) : (
              <View style={styles.paypalBox}>
                <Text style={styles.paypalText}>Tu reserva se procesará mediante tu cuenta autorizada de PayPal.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footerActions}>
        <View>
          <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: "600" }}>Total con impuestos</Text>
          <Text style={{ fontSize: 19, fontWeight: "800", color: colors.text }}>${total.toFixed(2)} MXN</Text>
        </View>
        {step < 4 ? (
          <Pressable
            style={[styles.primaryButton, (habitacionInterceptada || habitacionesLibresEnFechas.length === 0) && styles.primaryButtonDisabled]}
            onPress={goNext}
            disabled={habitacionInterceptada || habitacionesLibresEnFechas.length === 0}
          >
            <Text style={styles.primaryButtonText}>Continuar</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryButton, (!pagoValido || loading || habitacionInterceptada) && styles.primaryButtonDisabled]}
            onPress={onConfirm}
            disabled={!pagoValido || loading || habitacionInterceptada}
          >
            {loading ? <ActivityIndicator color={colors.textLight} /> : <Text style={styles.primaryButtonText}>Confirmar y Pagar</Text>}
          </Pressable>
        )}
      </View>

      <Modal visible={modalTerminos} animationType="slide" onRequestClose={() => setModalTerminos(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Términos y Condiciones</Text>
            <Pressable onPress={() => setModalTerminos(false)}>
              <Text style={styles.modalClose}>Cerrar</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalText}>
              <Text style={styles.modalSubtitle}>1. Horarios Oficiales de Hospedaje{"\n"}</Text>
              El horario de entrada (Check-in) es a partir de las 15:00 hrs y el horario de salida (Check-out) es a más tardar a las 12:00 hrs.{"\n\n"}
              <Text style={styles.modalSubtitle}>2. Reservaciones sin Overbooking{"\n"}</Text>
              Una vez confirmada una reservación mediante transacción atómica, una habitación disponible de la categoría elegida queda asignada exclusivamente al huésped titular para esas fechas.{"\n\n"}
              <Text style={styles.modalSubtitle}>3. Cancelaciones{"\n"}</Text>
              Puedes cancelar tu reservación desde la sección Mis Viajes liberando la habitación de inmediato.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={modalPrivacidad} animationType="slide" onRequestClose={() => setModalPrivacidad(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Aviso de Privacidad</Text>
            <Pressable onPress={() => setModalPrivacidad(false)}>
              <Text style={styles.modalClose}>Cerrar</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalText}>
              <Text style={styles.modalSubtitle}>1. Información recopilada{"\n"}</Text>
              Recopilamos nombre, correo, CURP y teléfono para validar tu identidad en el Check-in del hotel.{"\n\n"}
              <Text style={styles.modalSubtitle}>2. Protección de datos{"\n"}</Text>
              Tus datos se resguardan mediante cifrado TLS y reglas de seguridad en Google Cloud Firestore.{"\n\n"}
              <Text style={styles.modalSubtitle}>3. Derechos ARCO{"\n"}</Text>
              Puedes consultar o eliminar tu cuenta y datos personales en cualquier momento desde la pestaña Perfil.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 🛡️ Modal de última habitación de la categoría interceptada en esas fechas */}
      <Modal visible={habitacionInterceptada} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.interceptadaModal}>
            <View style={{ backgroundColor: "#fee2e2", padding: 14, borderRadius: 999 }}>
              <Ionicons name="alert-circle" size={42} color="#dc2626" />
            </View>
            <Text style={styles.interceptadaTitulo}>¡Última Habitación Interceptada!</Text>
            <Text style={styles.interceptadaDescripcion}>
              El motor distribuido detectó que la última habitación disponible de la categoría {categoriaObjetivo} para las fechas {entradaISO} al {salidaISO} acaba de ser reservada por otro canal.
            </Text>
            <Pressable
              style={styles.interceptadaBoton}
              onPress={() => {
                setHabitacionInterceptada(false);
                setStep(1);
              }}
            >
              <Text style={styles.interceptadaBotonText}>Elegir Otras Fechas</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 44,
    paddingBottom: 12,
    gap: 14,
    backgroundColor: colors.background,
  },
  backIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    paddingBottom: 130,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  stepText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  stepsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    gap: 6,
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stepDotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepDotDone: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  stepDotText: {
    color: colors.textSecondary,
    fontWeight: "700",
    fontSize: 12,
  },
  stepDotTextActive: {
    color: colors.textLight,
  },
  stepLabel: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: "center",
  },
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    shadowColor: colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    gap: 12,
  },
  ticketTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  hotelTitleCard: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800",
  },
  roomImage: {
    width: "100%",
    height: 175,
    borderRadius: 14,
    backgroundColor: colors.muted,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  availabilityBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  availabilityBannerOk: {
    backgroundColor: "#dcfce7",
  },
  availabilityBannerEmpty: {
    backgroundColor: "#fee2e2",
  },
  availabilityBannerText: {
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  occupiedDatesBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    gap: 3,
  },
  occupiedDatesTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: 2,
  },
  occupiedDatesItem: {
    fontSize: 11,
    color: colors.text,
    fontWeight: "600",
  },
  dateRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  datePickerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#f8fafc",
  },
  datePickerLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  datePickerValue: {
    marginTop: 6,
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  totalBox: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
    gap: 6,
  },
  priceLineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  ticketLine: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  ticketTotal: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: "800",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: -4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputReadOnly: {
    backgroundColor: "#f1f5f9",
    color: colors.textSecondary,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  inputError: {
    borderColor: colors.error,
  },
  terminosContainer: {
    paddingVertical: 6,
    alignItems: "center",
  },
  terminosText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    textAlign: "center",
  },
  terminosLink: {
    color: colors.primary,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  paymentSwitchRow: {
    flexDirection: "row",
    gap: 10,
  },
  paymentOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
  },
  paymentOptionActive: {
    borderColor: colors.primary,
    backgroundColor: "#e0f2fe",
  },
  paymentOptionText: {
    color: colors.textSecondary,
    fontWeight: "600",
    fontSize: 13,
  },
  paymentOptionTextActive: {
    color: colors.primaryDark,
    fontWeight: "800",
  },
  cardRow: {
    flexDirection: "row",
    gap: 10,
  },
  cardHalfInput: {
    flex: 1,
  },
  paypalBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: 16,
  },
  paypalText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  footerActions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -3 },
    elevation: 16,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minWidth: 160,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.textLight,
    fontWeight: "800",
    fontSize: 15,
  },
  centeredScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  successCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
    gap: 12,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
  },
  successText: {
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    fontSize: 14,
  },
  receiptMiniBox: {
    width: "100%",
    backgroundColor: "#f8fafc",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  receiptMiniLine: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  receiptMiniTotal: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "800",
    marginTop: 4,
  },
  mailText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
  },
  errorText: {
    color: colors.error,
    fontWeight: "700",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
  },
  modalClose: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "700",
  },
  modalContent: {
    padding: 20,
  },
  modalText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  modalSubtitle: {
    fontWeight: "800",
    color: colors.text,
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  interceptadaModal: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  interceptadaTitulo: {
    fontSize: 20,
    fontWeight: "800",
    color: "#dc2626",
    textAlign: "center",
  },
  interceptadaDescripcion: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 21,
  },
  interceptadaBoton: {
    backgroundColor: "#dc2626",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    width: "100%",
    alignItems: "center",
    marginTop: 6,
  },
  interceptadaBotonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },
});
