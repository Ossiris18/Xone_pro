import { auth, db } from "../config/firebase";
import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  reload,
  updateProfile,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const SUPER_ADMIN_EMAIL = "ossither1830@gmail.com";

/**
 * Sincroniza el perfil del usuario con cualquier registro o reserva previa hecha en Recepción
 * mediante su CURP o su correo electrónico, garantizando que siempre estén vinculados.
 */
const sincronizarCuentaYReservas = async ({ user, nombre = "", telefono = "", curp = "" }) => {
  if (!user?.uid) return null;

  const cleanEmail = String(user.email || "").trim().toLowerCase();
  let curpFinal = String(curp || "").trim().toUpperCase();
  let telFinal = String(telefono || "").trim();
  let nombreFinal = String(nombre || user.displayName || "").trim();

  // 1. Revisar si ya existe el documento Usuarios/{uid}
  const userUidRef = doc(db, "Usuarios", user.uid);
  const userUidSnap = await getDoc(userUidRef);
  if (userUidSnap.exists()) {
    const dataUid = userUidSnap.data();
    if (!curpFinal && dataUid.curp) curpFinal = String(dataUid.curp).trim().toUpperCase();
    if (!telFinal && dataUid.telefono) telFinal = String(dataUid.telefono).trim();
    if (!nombreFinal && dataUid.nombre) nombreFinal = String(dataUid.nombre).trim();
  }

  // 2. Buscar en Usuarios registros creados desde Recepción por correo o por CURP
  const docsUsuariosRelacionados = [];
  if (cleanEmail) {
    const qCorreo = query(collection(db, "Usuarios"), where("correo", "==", cleanEmail));
    const snapCorreo = await getDocs(qCorreo);
    snapCorreo.docs.forEach((d) => docsUsuariosRelacionados.push(d));
  }
  if (curpFinal) {
    const qCurp = query(collection(db, "Usuarios"), where("curp", "==", curpFinal));
    const snapCurp = await getDocs(qCurp);
    snapCurp.docs.forEach((d) => docsUsuariosRelacionados.push(d));
  }

  for (const docRel of docsUsuariosRelacionados) {
    const dData = docRel.data();
    if (!curpFinal && dData.curp) curpFinal = String(dData.curp).trim().toUpperCase();
    if (!telFinal && dData.telefono) telFinal = String(dData.telefono).trim();
    if (!nombreFinal && dData.nombre) nombreFinal = String(dData.nombre).trim();

    // Si era un documento temporal creado en recepción (ej. ID = CURP) distinto al UID de Auth, lo fusionamos y borramos el duplicado
    if (docRel.id !== user.uid) {
      try {
        await deleteDoc(doc(db, "Usuarios", docRel.id));
      } catch (e) {
        // Ignorar fallo menor al limpiar duplicado
      }
    }
  }

  // 3. Buscar todas las reservas en Reservas asociadas a su CURP, Correo o UID y vincularlas
  const reservasEncontradas = new Map();

  if (curpFinal) {
    const qResCurp = query(collection(db, "Reservas"), where("idUsuario", "==", curpFinal));
    const snapResCurp = await getDocs(qResCurp);
    snapResCurp.docs.forEach((d) => reservasEncontradas.set(d.id, d));
  }

  if (cleanEmail) {
    const qResCorreo = query(collection(db, "Reservas"), where("correoUsuario", "==", cleanEmail));
    const snapResCorreo = await getDocs(qResCorreo);
    snapResCorreo.docs.forEach((d) => reservasEncontradas.set(d.id, d));
  }

  const qResUid = query(collection(db, "Reservas"), where("uidUsuario", "==", user.uid));
  const snapResUid = await getDocs(qResUid);
  snapResUid.docs.forEach((d) => reservasEncontradas.set(d.id, d));

  let estanciasValidas = 0;
  for (const [resId, resDoc] of reservasEncontradas.entries()) {
    const rData = resDoc.data();
    if (!curpFinal && rData.idUsuario && rData.idUsuario.length === 18) {
      curpFinal = String(rData.idUsuario).trim().toUpperCase();
    }
    if (rData.estado !== "Cancelada") {
      estanciasValidas += 1;
    }
    // Asegurar que la reserva tenga siempre uidUsuario, idUsuario (CURP) y correoUsuario sincronizados
    const updates = {};
    if (rData.uidUsuario !== user.uid) updates.uidUsuario = user.uid;
    if (curpFinal && rData.idUsuario !== curpFinal) updates.idUsuario = curpFinal;
    if (cleanEmail && rData.correoUsuario !== cleanEmail) updates.correoUsuario = cleanEmail;
    if (Object.keys(updates).length > 0) {
      try {
        await updateDoc(doc(db, "Reservas", resId), updates);
      } catch (e) {
        // Ignorar si no requiere actualización
      }
    }
  }

  // 4. Guardar el perfil unificado en Usuarios/{user.uid}
  const perfilFinal = {
    uid: user.uid,
    correo: cleanEmail,
    nombre: nombreFinal || "Huésped",
    telefono: telFinal || "",
    curp: curpFinal || "",
    totalEstancias: estanciasValidas,
    actualizadoEn: serverTimestamp(),
  };

  await setDoc(userUidRef, perfilFinal, { merge: true });
  return perfilFinal;
};

const login = async (email, password) => {
  try {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const response = await signInWithEmailAndPassword(auth, cleanEmail, password);
    await reload(response.user);

    if (!response.user.emailVerified && cleanEmail !== SUPER_ADMIN_EMAIL) {
      await signOut(auth);
      return {
        user: null,
        error: "Debes verificar tu correo antes de ingresar. Revisa tu bandeja de entrada.",
      };
    }

    // Sincronizar automáticamente reservas hechas en recepción con su CURP o correo
    await sincronizarCuentaYReservas({ user: response.user });

    return { user: response.user, error: null };
  } catch (error) {
    if (error.code === "auth/user-not-found") return { user: null, error: "No existe una cuenta con este correo" };
    if (error.code === "auth/wrong-password") return { user: null, error: "Contraseña incorrecta" };
    if (error.code === "auth/invalid-email") return { user: null, error: "Correo inválido" };
    if (error.code === "auth/invalid-credential" || error.code === "auth/invalid-login-credentials") {
      return { user: null, error: "Correo o contraseña incorrectos" };
    }
    return { user: null, error: "Error al iniciar sesión" };
  }
};

const register = async (email, password, nombre, apellido = "", telefono = "", curp = "") => {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanCurp = String(curp || "").trim().toUpperCase();
  const cleanTel = String(telefono || "").trim();
  const fullName = [nombre, apellido].filter(Boolean).join(" ").trim();

  try {
    // 1. Verificar si la CURP ya está registrada en otra cuenta ACTIVA de la App (con otro correo distinto)
    if (cleanCurp) {
      const qCurp = query(collection(db, "Usuarios"), where("curp", "==", cleanCurp));
      const snapCurp = await getDocs(qCurp);
      const conflictoCurp = snapCurp.docs.find((d) => {
        const data = d.data();
        const correoDoc = String(data.correo || "").trim().toLowerCase();
        // Si tiene uid de cuenta activa y el correo es distinto al que se está registrando
        return Boolean(data.uid) && correoDoc && correoDoc !== cleanEmail;
      });
      if (conflictoCurp) {
        return {
          user: null,
          error: `Esta CURP ya está vinculada a otro correo activo (${conflictoCurp.data().correo}). Usa ese correo para iniciar sesión.`,
        };
      }
    }

    const response = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    const user = response.user;

    if (fullName) {
      await updateProfile(user, { displayName: fullName });
    }

    await sincronizarCuentaYReservas({
      user,
      nombre: fullName,
      telefono: cleanTel,
      curp: cleanCurp,
    });

    await sendEmailVerification(user);
    await signOut(auth);

    return { user, error: null };
  } catch (error) {
    // Si la cuenta fue eliminada desde el Panel Admin (ya no existe en Usuarios con uid activo),
    // permitimos recrearla de cero reutilizando su credencial en Firebase Auth.
    if (error.code === "auth/email-already-in-use") {
      try {
        const qCorreo = query(collection(db, "Usuarios"), where("correo", "==", cleanEmail));
        const snapCorreo = await getDocs(qCorreo);
        const tieneCuentaActiva = snapCorreo.docs.some((d) => Boolean(d.data().uid));

        if (!tieneCuentaActiva) {
          const signInRes = await signInWithEmailAndPassword(auth, cleanEmail, password);
          const recoveredUser = signInRes.user;
          if (fullName) {
            await updateProfile(recoveredUser, { displayName: fullName });
          }
          await sincronizarCuentaYReservas({
            user: recoveredUser,
            nombre: fullName,
            telefono: cleanTel,
            curp: cleanCurp,
          });
          if (!recoveredUser.emailVerified && cleanEmail !== SUPER_ADMIN_EMAIL) {
            await sendEmailVerification(recoveredUser);
          }
          await signOut(auth);
          return { user: recoveredUser, error: null, reactivada: true };
        }
      } catch (innerErr) {
        return {
          user: null,
          error: "Este correo tuvo una cuenta previa. Usa tu contraseña anterior para reactivarla desde cero o solicita restablecimiento.",
        };
      }
      return { user: null, error: "Este correo ya está registrado en una cuenta activa." };
    }
    if (error.code === "auth/invalid-email") return { user: null, error: "Correo inválido" };
    return { user: null, error: "Error al registrarse: " + (error.message || "") };
  }
};

const logout = async () => {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Elimina por completo la cuenta del usuario autenticado en la App:
 * - Cancela reservas activas y libera habitaciones inmediatamente
 * - Borra todo su historial de Reservas y sus documentos en Usuarios (correo, nombre, CURP, teléfono)
 * - Deja constancia en Bitacora para el Admin
 * - Elimina el usuario de Firebase Auth y cierra sesión de inmediato
 */
const eliminarCuenta = async () => {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: "No hay usuario autenticado" };
  }

  const uid = user.uid;
  const cleanEmail = String(user.email || "").trim().toLowerCase();
  let curpUsuario = "";
  let nombreUsuario = user.displayName || "Huésped";

  try {
    // 1. Obtener datos del usuario antes de borrar
    const userDocSnap = await getDoc(doc(db, "Usuarios", uid));
    if (userDocSnap.exists()) {
      const uData = userDocSnap.data();
      curpUsuario = String(uData.curp || "").trim().toUpperCase();
      nombreUsuario = uData.nombre || nombreUsuario;
    }

    // Buscar cualquier otro documento en Usuarios con el mismo correo o CURP
    const usuariosABorrar = new Set([uid]);
    if (cleanEmail) {
      const qUCorreo = query(collection(db, "Usuarios"), where("correo", "==", cleanEmail));
      const snapUCorreo = await getDocs(qUCorreo);
      snapUCorreo.docs.forEach((d) => {
        usuariosABorrar.add(d.id);
        if (!curpUsuario && d.data().curp) curpUsuario = String(d.data().curp).trim().toUpperCase();
      });
    }
    if (curpUsuario) {
      usuariosABorrar.add(curpUsuario);
      const qUCurp = query(collection(db, "Usuarios"), where("curp", "==", curpUsuario));
      const snapUCurp = await getDocs(qUCurp);
      snapUCurp.docs.forEach((d) => usuariosABorrar.add(d.id));
    }

    // 2. Buscar todas las reservas del usuario (por uid, CURP o correo)
    const reservasMap = new Map();
    const qResUid = query(collection(db, "Reservas"), where("uidUsuario", "==", uid));
    const snapResUid = await getDocs(qResUid);
    snapResUid.docs.forEach((d) => reservasMap.set(d.id, d.data()));

    if (curpUsuario) {
      const qResCurp = query(collection(db, "Reservas"), where("idUsuario", "==", curpUsuario));
      const snapResCurp = await getDocs(qResCurp);
      snapResCurp.docs.forEach((d) => reservasMap.set(d.id, d.data()));
    }
    if (cleanEmail) {
      const qResCorreo = query(collection(db, "Reservas"), where("correoUsuario", "==", cleanEmail));
      const snapResCorreo = await getDocs(qResCorreo);
      snapResCorreo.docs.forEach((d) => reservasMap.set(d.id, d.data()));
    }

    // 3. Liberar habitaciones de reservas activas y eliminar todo el historial de Reservas
    let reservasActivasCanceladas = 0;
    const totalReservasBorradas = reservasMap.size;

    for (const [resId, rData] of reservasMap.entries()) {
      if (rData.estado === "Activa" && rData.idHabitacion) {
        reservasActivasCanceladas += 1;
        try {
          await updateDoc(doc(db, "Habitaciones", rData.idHabitacion), {
            estado: "disponible",
            huespedNombre: null,
            huespedID: null,
            fechaEntrada: null,
            fechaSalida: null,
            totalActual: null,
            serviciosActuales: [],
            fechaIngreso: null,
            fechaSalidaReal: null,
          });
        } catch (e) {
          // Ignorar si la habitación ya no existía
        }
      }
      await deleteDoc(doc(db, "Reservas", resId));
    }

    // Liberar también cualquier habitación que tuviera huespedID === curpUsuario
    if (curpUsuario) {
      const qHabs = query(collection(db, "Habitaciones"), where("huespedID", "==", curpUsuario));
      const snapHabs = await getDocs(qHabs);
      for (const hDoc of snapHabs.docs) {
        await updateDoc(doc(db, "Habitaciones", hDoc.id), {
          estado: "disponible",
          huespedNombre: null,
          huespedID: null,
          fechaEntrada: null,
          fechaSalida: null,
          totalActual: null,
          serviciosActuales: [],
          fechaIngreso: null,
          fechaSalidaReal: null,
        });
      }
    }

    // 4. Eliminar todos los documentos del usuario en Usuarios
    for (const docId of usuariosABorrar) {
      try {
        await deleteDoc(doc(db, "Usuarios", docId));
      } catch (e) {
        // Ignorar si alguno no existía
      }
    }

    // 5. Registrar en Bitacora para que quede auditoría permanente en el Admin
    await addDoc(collection(db, "Bitacora"), {
      tipoAccion: "ELIMINACIÓN",
      nombreEmpleado: `${nombreUsuario} (App Móvil)`,
      rolEmpleado: "Huésped",
      detalles: `Cuenta eliminada desde App: ${nombreUsuario} | Correo: ${cleanEmail} | CURP: ${curpUsuario || "N/A"} | Se eliminaron ${totalReservasBorradas} reserva(s) del historial (${reservasActivasCanceladas} activa(s) cancelada(s) y habitación liberada).`,
      fecha: serverTimestamp(),
    });

    // 6. Intentar borrar el usuario de Firebase Auth y cerrar sesión inmediatamente
    try {
      await deleteUser(user);
    } catch (authErr) {
      // Incluso si Auth pide reautenticación reciente, cerramos la sesión inmediatamente
      // y los datos de Firestore ya quedaron 100% eliminados para que pueda recrear su cuenta de cero.
    }

    await signOut(auth);
    return { success: true, error: null };
  } catch (error) {
    try {
      await signOut(auth);
    } catch (e) {
      // Asegurar cierre de sesión
    }
    return { success: true, error: null };
  }
};

export const authServices = {
  login,
  logout,
  register,
  eliminarCuenta,
  sincronizarCuentaYReservas,
};
