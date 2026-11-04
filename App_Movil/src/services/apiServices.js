import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";

const EMAILJS_SERVICE_ID = process.env.EXPO_PUBLIC_EMAILJS_SERVICE_ID || "service_br0yn2y";
const EMAILJS_TEMPLATE_ID = process.env.EXPO_PUBLIC_EMAILJS_TEMPLATE_ID || "template_frhsxvn";
const EMAILJS_PUBLIC_KEY = process.env.EXPO_PUBLIC_EMAILJS_PUBLIC_KEY || "15C3JhlfZqU25RCNm";
const EMAILJS_PRIVATE_KEY = process.env.EXPO_PUBLIC_EMAILJS_PRIVATE_KEY || "oIMNECNhjSjnBwfdeSnpA";
const EMAILJS_URL = "https://api.emailjs.com/api/v1.0/email/send";

const mapDoc = (docSnapshot) => ({
  id: docSnapshot.id,
  ...docSnapshot.data(),
});

const obtenerFechaLocalISO = (fecha = new Date()) => {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
};

/**
 * Sincroniza automáticamente los estados de habitaciones y reservas según el reloj real:
 * - Si llega la fechaSalida a las 12:00 PM -> la reserva pasa a 'Completada' y la habitación a 'mantenimiento' (12:00 a 15:00 hrs).
 * - A partir de las 15:00 hrs (3:00 PM) -> las habitaciones en 'mantenimiento' pasan automáticamente a 'disponible'
 *   (o a 'ocupado' si tienen una reserva activa para hoy).
 */
export const sincronizarRelojHabitaciones = async () => {
  try {
    const ahora = new Date();
    const hoyISO = obtenerFechaLocalISO(ahora);
    const horaActual = ahora.getHours();

    const [habsSnap, resActivasSnap] = await Promise.all([
      getDocs(collection(db, "Habitaciones")),
      getDocs(query(collection(db, "Reservas"), where("estado", "==", "Activa"))),
    ]);

    const reservasActivas = resActivasSnap.docs.map(mapDoc);
    const promesas = [];

    // 1. Revisar reservas activas cuya fechaSalida ya venció (o es hoy y ya son >= 12:00 hrs)
    const reservasSigueActivasHoyPorHab = new Map();

    for (const res of reservasActivas) {
      const salida = res.fechaSalida || "";
      const entrada = res.fechaEntrada || "";

      const vencioDiaAnterior = salida && salida < hoyISO;
      const vencioHoyMediodia = salida === hoyISO && horaActual >= 12;

      if (vencioDiaAnterior || vencioHoyMediodia) {
        promesas.push(
          updateDoc(doc(db, "Reservas", res.id), {
            estado: "Completada",
            fechaSalidaReal: serverTimestamp(),
          })
        );
      } else {
        // Esta reserva sigue activa; verificar si ocupa la habitación el día de HOY
        const ocupaHoy =
          entrada <= hoyISO &&
          salida > hoyISO &&
          (entrada < hoyISO || horaActual >= 15 || res.metodoPago === "Recepción Directa");
        if (ocupaHoy && res.idHabitacion) {
          reservasSigueActivasHoyPorHab.set(res.idHabitacion, res);
        }
      }
    }

    // 2. Sincronizar el estado físico de cada habitación para el día y hora actual
    for (const habDoc of habsSnap.docs) {
      const hab = mapDoc(habDoc);
      const resHoy = reservasSigueActivasHoyPorHab.get(hab.id);
      const salidaHab = hab.fechaSalida || "";

      if (hab.estado === "ocupado") {
        const salioDiaAnterior = salidaHab && salidaHab < hoyISO;
        const salioHoyMediodia = salidaHab === hoyISO && horaActual >= 12;

        if (salioDiaAnterior || salioHoyMediodia) {
          if (salioHoyMediodia && horaActual < 15) {
            // Entre 12:00 PM y 3:00 PM pasa automáticamente a mantenimiento (limpieza)
            promesas.push(
              updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: "mantenimiento",
                fechaMantenimientoISO: hoyISO,
                fechaSalidaReal: serverTimestamp(),
              })
            );
          } else if (resHoy) {
            promesas.push(
              updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: "ocupado",
                huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || "Huésped",
                huespedID: resHoy.idUsuario || "",
                fechaEntrada: resHoy.fechaEntrada,
                fechaSalida: resHoy.fechaSalida,
                totalActual: resHoy.totalGenerado || hab.precioBase,
              })
            );
          } else {
            // Ya pasaron las 3:00 PM o era de un día anterior: pasa a disponible
            promesas.push(
              updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: "disponible",
                huespedNombre: null,
                huespedID: null,
                fechaEntrada: null,
                fechaSalida: null,
                totalActual: null,
                fechaIngreso: null,
              })
            );
          }
        } else if (hab.fechaEntrada && hab.fechaEntrada > hoyISO && !resHoy) {
          // Si tenía guardada una reserva futura pero HOY está libre, hoy debe figurar disponible
          promesas.push(
            updateDoc(doc(db, "Habitaciones", hab.id), {
              estado: "disponible",
              huespedNombre: null,
              huespedID: null,
              fechaEntrada: null,
              fechaSalida: null,
              totalActual: null,
              fechaIngreso: null,
            })
          );
        }
      } else if (hab.estado === "mantenimiento") {
        // A las 3:00 PM (15:00 hrs) pasa automáticamente a libre (o a ocupado si entra alguien hoy)
        const fechaMant = hab.fechaMantenimientoISO || hoyISO;
        if (horaActual >= 15 || fechaMant < hoyISO) {
          if (resHoy) {
            promesas.push(
              updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: "ocupado",
                huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || "Huésped",
                huespedID: resHoy.idUsuario || "",
                fechaEntrada: resHoy.fechaEntrada,
                fechaSalida: resHoy.fechaSalida,
                totalActual: resHoy.totalGenerado || hab.precioBase,
              })
            );
          } else {
            promesas.push(
              updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: "disponible",
                huespedNombre: null,
                huespedID: null,
                fechaEntrada: null,
                fechaSalida: null,
                totalActual: null,
                fechaIngreso: null,
                fechaMantenimientoISO: null,
              })
            );
          }
        }
      } else if (hab.estado === "disponible" && resHoy) {
        // Si hoy hay una reserva activa vigente para esta habitación y ya es hora de check-in
        promesas.push(
          updateDoc(doc(db, "Habitaciones", hab.id), {
            estado: "ocupado",
            huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || "Huésped",
            huespedID: resHoy.idUsuario || "",
            fechaEntrada: resHoy.fechaEntrada,
            fechaSalida: resHoy.fechaSalida,
            totalActual: resHoy.totalGenerado || hab.precioBase,
          })
        );
      }
    }

    if (promesas.length > 0) {
      await Promise.allSettled(promesas);
    }
  } catch (e) {
    // Ignorar errores silenciosos de red durante sincronización de reloj
  }
};

export const getSucursales = async () => {
  await sincronizarRelojHabitaciones();

  const [sucursalesSnap, habitacionesSnap] = await Promise.all([
    getDocs(collection(db, "Sucursales")),
    getDocs(collection(db, "Habitaciones")),
  ]);

  const habitaciones = habitacionesSnap.docs.map(mapDoc);

  return sucursalesSnap.docs.map((docSnap) => {
    const hotel = mapDoc(docSnap);
    const habsHotel = habitaciones.filter((h) => h.idSucursal === hotel.id);
    const disponiblesHoy = habsHotel.filter((h) => h.estado === "disponible");
    const precios = habsHotel
      .map((h) => Number(h.precioBase || 0))
      .filter((p) => p > 0);

    return {
      ...hotel,
      precioMinimo: precios.length > 0 ? Math.min(...precios) : null,
      // Todas las habitaciones pueden apartarse para otras fechas; disponiblesHoy indica libres hoy mismo
      disponiblesCount: habsHotel.length,
      disponiblesHoyCount: disponiblesHoy.length,
      totalHabitaciones: habsHotel.length,
    };
  });
};

export const getSucursalById = async (idSucursal) => {
  const snapshot = await getDoc(doc(db, "Sucursales", idSucursal));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
};

export const getHabitacionesBySucursal = async (idSucursal) => {
  const habitacionesQuery = query(
    collection(db, "Habitaciones"),
    where("idSucursal", "==", idSucursal)
  );

  const snapshot = await getDocs(habitacionesQuery);
  return snapshot.docs.map(mapDoc);
};

export const getHabitacionesDisponiblesBySucursal = async (idSucursal) => {
  const habitacionesQuery = query(
    collection(db, "Habitaciones"),
    where("idSucursal", "==", idSucursal)
  );

  const snapshot = await getDocs(habitacionesQuery);
  return snapshot.docs.map(mapDoc);
};

export const getUsuarioPorUid = async (uid) => {
  if (!uid) return null;
  const emailActual = String(auth.currentUser?.email || "").trim().toLowerCase();

  const directRef = await getDoc(doc(db, "Usuarios", uid));
  let datosBase = directRef.exists() ? mapDoc(directRef) : null;

  if (!datosBase) {
    const usuariosQuery = query(collection(db, "Usuarios"), where("uid", "==", uid));
    const snapshot = await getDocs(usuariosQuery);
    if (!snapshot.empty) {
      datosBase = mapDoc(snapshot.docs[0]);
    }
  }

  // Si en Recepción registraron a este usuario con su correo y CURP, fusionar automáticamente su CURP
  if (emailActual && (!datosBase || !datosBase.curp)) {
    const qCorreo = query(collection(db, "Usuarios"), where("correo", "==", emailActual));
    const snapCorreo = await getDocs(qCorreo);
    if (!snapCorreo.empty) {
      const docRecep = mapDoc(snapCorreo.docs[0]);
      datosBase = {
        ...docRecep,
        ...datosBase,
        curp: datosBase?.curp || docRecep.curp || "",
        telefono: datosBase?.telefono || docRecep.telefono || "",
        nombre: datosBase?.nombre || docRecep.nombre || "",
      };
    }
  }

  return datosBase;
};

export const getReservasByUsuario = async (curp, uid, correo = "") => {
  const resultados = new Map();
  const cleanCurp = String(curp || "").trim().toUpperCase();
  const cleanEmail = String(correo || auth.currentUser?.email || "").trim().toLowerCase();

  if (cleanCurp) {
    const qCurp = query(collection(db, "Reservas"), where("idUsuario", "==", cleanCurp));
    const snapCurp = await getDocs(qCurp);
    snapCurp.docs.forEach((d) => resultados.set(d.id, mapDoc(d)));
  }

  if (uid) {
    const qUid = query(collection(db, "Reservas"), where("uidUsuario", "==", uid));
    const snapUid = await getDocs(qUid);
    snapUid.docs.forEach((d) => resultados.set(d.id, mapDoc(d)));
  }

  if (cleanEmail) {
    const qCorreo = query(collection(db, "Reservas"), where("correoUsuario", "==", cleanEmail));
    const snapCorreo = await getDocs(qCorreo);
    snapCorreo.docs.forEach((d) => resultados.set(d.id, mapDoc(d)));
  }

  // Vincular en segundo plano cualquier reserva de recepción que aún no tuviera el uidUsuario o idUsuario
  for (const [resId, resData] of resultados.entries()) {
    const updates = {};
    if (uid && resData.uidUsuario !== uid) updates.uidUsuario = uid;
    if (cleanCurp && resData.idUsuario !== cleanCurp) updates.idUsuario = cleanCurp;
    if (cleanEmail && resData.correoUsuario !== cleanEmail) updates.correoUsuario = cleanEmail;
    if (Object.keys(updates).length > 0) {
      updateDoc(doc(db, "Reservas", resId), updates).catch(() => {});
    }
  }

  const lista = Array.from(resultados.values());
  lista.sort((a, b) => (b.fechaIngreso?.toMillis?.() || 0) - (a.fechaIngreso?.toMillis?.() || 0));
  return lista;
};

export const prepararEnvioComprobante = async ({ correoDestino, plantilla }) => {
  const templateParams = {
    to_email: correoDestino,
    nombre_huesped: plantilla?.nombreUsuario || "Huésped",
    hotel: plantilla?.hotel || "Xone Hotels",
    numero_habitacion: plantilla?.numeroHabitacion || "-",
    pais: plantilla?.pais || "No especificado",
    municipio: plantilla?.municipio || "No especificado",
    direccion: plantilla?.direccion || "No especificada",
    precio_total: plantilla?.total || 0,
    fecha_entrada: plantilla?.fechaEntrada || "Por definir",
    fecha_salida: plantilla?.fechaSalida || "Por definir",
  };

  try {
    const response = await fetch(EMAILJS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY,
        template_params: templateParams,
      }),
    });

    if (!response.ok) {
      const detalle = await response.text();
      return { status: "error", detalle };
    }

    return { status: "enviado", provider: "EmailJS" };
  } catch (err) {
    return { status: "error", detalle: err.message };
  }
};

export const apiServices = {
  sincronizarRelojHabitaciones,
  getSucursales,
  getSucursalById,
  getHabitacionesBySucursal,
  getHabitacionesDisponiblesBySucursal,
  getUsuarioPorUid,
  getReservasByUsuario,
  prepararEnvioComprobante,
};
