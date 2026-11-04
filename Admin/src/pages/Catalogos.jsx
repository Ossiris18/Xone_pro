import React, { useState, useEffect, useCallback, useContext } from 'react';
import { collection, addDoc, getDocs, deleteDoc, updateDoc, doc, query, where, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { db, secondaryAuth } from '../firebase';
import { SesionContext } from '../context/SesionContext';
import { Trash2, MapPin, Image as ImageIcon, X, CheckCircle2, AlertCircle, Edit3, Save } from 'lucide-react';

// === IMPORTACIONES DEL MAPA GLOBAL XONE ===
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const iconoMapa = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

function MapClicker({ coordsTemp, setCoordsTemp }) {
  useMapEvents({
    click(e) {
      setCoordsTemp({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });
  return <Marker position={[coordsTemp.lat, coordsTemp.lng]} icon={iconoMapa} />;
}

const TIPOS_HABITACION = ["Tradicional", "Junior Suite", "Suite", "Presidencial", "Cabaña Eco"];
const SERVICIOS_DISPONIBLES = [
  "1 Cama Matrimonial", "2 Camas Matrimoniales", "1 Cama King Size",
  "1 Baño Completo", "2 Baños", "Jacuzzi Privado", "Alberca 24hrs",
  "Cocina Equipada", "Refrigerador", "Cámaras 24/7", "Caja Fuerte",
  "Vista Mar", "Vista Selva", "WiFi", "Clima"
];

const UBICACIONES_INICIALES = {
  "México": {
    "Chiapas": [
      "Tuxtla Gutiérrez",
      "San Cristóbal de las Casas",
      "Palenque",
      "Tapachula",
      "Comitán de Domínguez",
      "Chiapa de Corzo",
      "Tonalá",
      "Ocosingo"
    ],
    "Quintana Roo": ["Cancún", "Playa del Carmen", "Tulum", "Cozumel", "Bacalar"],
    "Ciudad de México": ["Cuauhtémoc", "Miguel Hidalgo", "Benito Juárez", "Coyoacán"],
    "Jalisco": ["Guadalajara", "Puerto Vallarta", "Zapopan", "Tequila"],
    "Oaxaca": ["Oaxaca de Juárez", "Huatulco", "Puerto Escondido"],
    "Yucatán": ["Mérida", "Valladolid", "Progreso"],
    "Nuevo León": ["Monterrey", "San Pedro Garza García"]
  }
};

// Compresión inteligente en Canvas para minimizar latencia en Firestore (< 80KB por foto)
const comprimirImagenABase64 = (archivo, maxWidth = 900, quality = 0.72) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(archivo);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Validación oficial de estructura RENAPO de 18 caracteres sin falsos rechazos de dígito verificador
const validarCurpMatematica = (curp) => {
  const curpLimpia = String(curp || '').trim().toUpperCase();
  if (curpLimpia.length !== 18) return false;
  const regex = /^[A-ZÑ]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX][A-Z]{2}[A-ZÑ]{3}[0-9A-Z]\d$/;
  return regex.test(curpLimpia);
};

// Calcula el siguiente número consecutivo disponible empezando siempre desde el 1 (1, 2, 3...)
const calcularSiguienteNumeroLibre = (numerosOcupados = []) => {
  const setOcupados = new Set(numerosOcupados.map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n) && n >= 1));
  let candidato = 1;
  while (setOcupados.has(candidato)) {
    candidato += 1;
  }
  return candidato;
};

// Auto-migración de habitaciones que hayan quedado con numeración 101, 102... para que empiecen desde 1, 2...
const normalizarNumeracionDesdeUno = async (docsHabitaciones) => {
  const tieneMayoresA100 = docsHabitaciones.some(h => parseInt(h.numero, 10) >= 101);
  if (!tieneMayoresA100) return false;

  // Agrupar por sucursal y renumerar consecutivamente 1, 2, 3...
  const porSucursal = {};
  docsHabitaciones.forEach(h => {
    const sucId = h.idSucursal || 'GENERAL';
    if (!porSucursal[sucId]) porSucursal[sucId] = [];
    porSucursal[sucId].push(h);
  });

  let huboCambios = false;
  for (const sucId of Object.keys(porSucursal)) {
    const lista = porSucursal[sucId].sort((a, b) => parseInt(a.numero, 10) - parseInt(b.numero, 10));
    const usados = new Set();

    // Conservar primero las que ya son < 101
    lista.forEach(h => {
      const n = parseInt(h.numero, 10);
      if (!Number.isNaN(n) && n >= 1 && n < 101) {
        usados.add(n);
      }
    });

    for (const h of lista) {
      const numActual = parseInt(h.numero, 10);
      if (Number.isNaN(numActual) || numActual >= 101) {
        let nuevoNum = 1;
        while (usados.has(nuevoNum)) {
          nuevoNum += 1;
        }
        usados.add(nuevoNum);
        const nuevoStr = String(nuevoNum);
        await updateDoc(doc(db, "Habitaciones", h.id), { numero: nuevoStr });

        // Actualizar también en Reservas que apunten a esta habitación
        const qRes = query(collection(db, "Reservas"), where("idHabitacion", "==", h.id));
        const snapRes = await getDocs(qRes);
        for (const rDoc of snapRes.docs) {
          await updateDoc(doc(db, "Reservas", rDoc.id), { numeroHabitacion: nuevoStr });
        }
        huboCambios = true;
      }
    }
  }
  return huboCambios;
};

function Catalogos() {
  const sesion = useContext(SesionContext);
  const [pestañaActiva, setPestañaActiva] = useState('franquicias');
  const [catalogoUbicaciones, setCatalogoUbicaciones] = useState(UBICACIONES_INICIALES);
  const [listaFranquicias, setListaFranquicias] = useState([]);
  const [listaSucursales, setListaSucursales] = useState([]);
  const [listaHabitaciones, setListaHabitaciones] = useState([]);
  const [listaPersonal, setListaPersonal] = useState([]);
  const [listaHuespedes, setListaHuespedes] = useState([]);

  const [archivoHotel, setArchivoHotel] = useState(null);
  const [archivoHabitacion, setArchivoHabitacion] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [numerosHabitacionExistentes, setNumerosHabitacionExistentes] = useState([]);

  const [toast, setToast] = useState(null);
  const [editandoHabId, setEditandoHabId] = useState(null);
  const [precioEditado, setPrecioEditado] = useState('');
  const [eliminandoHuespedId, setEliminandoHuespedId] = useState(null);

  const mostrarNotificacion = (mensaje, tipo = 'exito') => {
    setToast({ mensaje, tipo });
    setTimeout(() => setToast(null), 4000);
  };

  const [nuevaFranquicia, setNuevaFranquicia] = useState({
    nombreCorporativo: '', correoContacto: '', direccionPrincipal: '',
    nombreDueño: '', curpDueño: '', telefonoDueño: ''
  });
  const [nuevaSucursal, setNuevaSucursal] = useState({
    idFranquicia: '', nombre: '',
    ubicacion: { pais: '', estado: '', municipio: '', direccion: '', lat: '', lng: '' },
    moneda: 'MXN'
  });
  // Número inicial empieza siempre en 1 y sigue con 2, 3, etc.
  const [configHabitacion, setConfigHabitacion] = useState({
    idFranquicia: '', idSucursal: '', cantidad: 1, numeroInicial: 1,
    tipo: 'Tradicional', precioBase: 1500, servicios: []
  });
  const [nuevoEmpleado, setNuevoEmpleado] = useState({
    nombre: '', curp: '', correo: '', password: '',
    rol: 'Recepcionista', idFranquicia: '', idSucursal: ''
  });

  const [mostrarMapa, setMostrarMapa] = useState(false);
  const [coordsTemp, setCoordsTemp] = useState({ lat: 16.7569, lng: -93.1292 });

  const confirmarUbicacion = () => {
    setNuevaSucursal({
      ...nuevaSucursal,
      ubicacion: {
        ...nuevaSucursal.ubicacion,
        lat: coordsTemp.lat.toFixed(6),
        lng: coordsTemp.lng.toFixed(6)
      }
    });
    setMostrarMapa(false);
  };

  const handleSucursalChange = async (e) => {
    const nuevoIdSucursal = e.target.value;
    setConfigHabitacion(prev => ({ ...prev, idSucursal: nuevoIdSucursal }));

    if (!nuevoIdSucursal) {
      setNumerosHabitacionExistentes([]);
      setListaHabitaciones([]);
      setConfigHabitacion(prev => ({ ...prev, numeroInicial: 1 }));
      return;
    }

    try {
      const q = query(collection(db, "Habitaciones"), where("idSucursal", "==", nuevoIdSucursal));
      let querySnapshot = await getDocs(q);
      let docs = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Si había habitaciones numeradas como 101, 102..., pasarlas automáticamente a 1, 2...
      const migrado = await normalizarNumeracionDesdeUno(docs);
      if (migrado) {
        querySnapshot = await getDocs(q);
        docs = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      docs.sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true }));
      setListaHabitaciones(docs);

      const numeros = docs.map(d => parseInt(d.numero, 10)).filter(n => !Number.isNaN(n));
      setNumerosHabitacionExistentes(numeros);

      const siguienteLibre = calcularSiguienteNumeroLibre(numeros);
      setConfigHabitacion(prev => ({ ...prev, numeroInicial: siguienteLibre }));
    } catch (err) {
      console.error("Error al buscar habitaciones:", err);
    }
  };

  const cargarDatos = useCallback(async () => {
    if (!sesion) return;
    const esAdminFranquicia = sesion.rol === 'Admin Franquicia';
    const esAdminVIP = sesion.rol === 'Admin VIP';

    try {
      // Verificar y migrar cualquier habitación con numeración >= 101 en toda la base
      const todasHabsSnap = await getDocs(collection(db, "Habitaciones"));
      await normalizarNumeracionDesdeUno(todasHabsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const catSnap = await getDocs(collection(db, "Catalogos"));
      if (!catSnap.empty) {
        const primerDoc = catSnap.docs[0];
        const data = primerDoc.data();
        if (data.Ubicaciones) setCatalogoUbicaciones(data.Ubicaciones);
      } else {
        await addDoc(collection(db, "Catalogos"), { Ubicaciones: UBICACIONES_INICIALES });
        setCatalogoUbicaciones(UBICACIONES_INICIALES);
      }

      let franquiciasQuery = collection(db, "Franquicias");
      if (esAdminFranquicia) franquiciasQuery = query(franquiciasQuery, where('__name__', '==', sesion.idFranquicia));
      const franqSnap = await getDocs(franquiciasQuery);
      setListaFranquicias(franqSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      let sucursalesQuery = collection(db, "Sucursales");
      if (esAdminFranquicia) sucursalesQuery = query(sucursalesQuery, where("idFranquicia", "==", sesion.idFranquicia));
      const sucSnap = await getDocs(sucursalesQuery);
      setListaSucursales(sucSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      let personalQuery = collection(db, "Personal");
      if (esAdminFranquicia) personalQuery = query(personalQuery, where("idFranquicia", "==", sesion.idFranquicia));
      const persSnap = await getDocs(personalQuery);
      setListaPersonal(persSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      if (esAdminVIP) {
        const [huespedSnap, reservasSnap] = await Promise.all([
          getDocs(collection(db, "Usuarios")),
          getDocs(collection(db, "Reservas"))
        ]);

        const reservasValidas = reservasSnap.docs
          .map(r => r.data())
          .filter(r => r.estado !== 'Cancelada');

        const huespedesCalc = huespedSnap.docs.map(d => {
          const data = d.data();
          const curpUser = (data.curp || '').trim().toUpperCase();
          const correoUser = (data.correo || '').trim().toLowerCase();
          const uidUser = data.uid || d.id;

          // Contar todas las reservas reales vinculadas a su CURP, UID o correo
          const conteoReal = reservasValidas.filter(r =>
            (curpUser && String(r.idUsuario || '').toUpperCase() === curpUser) ||
            (uidUser && r.uidUsuario === uidUser) ||
            (correoUser && String(r.correoUsuario || '').toLowerCase() === correoUser)
          ).length;

          return {
            id: d.id,
            ...data,
            reservasReales: conteoReal
          };
        });

        setListaHuespedes(huespedesCalc);
      } else {
        setListaHuespedes([]);
      }
    } catch (err) {
      console.error("Error al cargar datos de catálogos:", err);
    }
  }, [sesion]);

  useEffect(() => {
    const iniciar = async () => {
      if (sesion) {
        await cargarDatos();
        if (sesion.rol === 'Admin Franquicia') {
          setNuevaSucursal(prev => ({ ...prev, idFranquicia: sesion.idFranquicia }));
          setConfigHabitacion(prev => ({ ...prev, idFranquicia: sesion.idFranquicia }));
          setNuevoEmpleado(prev => ({ ...prev, idFranquicia: sesion.idFranquicia }));
        }
      }
    };
    iniciar();
  }, [cargarDatos, sesion]);

  // Validaciones
  const correoFranquiciaValido = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(nuevaFranquicia.correoContacto);
  const curpDueñoValida = validarCurpMatematica(nuevaFranquicia.curpDueño.toUpperCase());
  const formFranquiciaValido = nuevaFranquicia.nombreCorporativo.trim() !== '' && correoFranquiciaValido && nuevaFranquicia.direccionPrincipal.trim() !== '' && nuevaFranquicia.nombreDueño.trim() !== '' && curpDueñoValida && nuevaFranquicia.telefonoDueño.trim() !== '';
  const formSucursalValido = nuevaSucursal.idFranquicia !== '' && nuevaSucursal.nombre.trim() !== '' && nuevaSucursal.ubicacion.pais !== '' && nuevaSucursal.ubicacion.estado !== '' && nuevaSucursal.ubicacion.municipio !== '' && nuevaSucursal.ubicacion.direccion.trim() !== '' && nuevaSucursal.ubicacion.lat !== '' && nuevaSucursal.ubicacion.lng !== '' && archivoHotel !== null;

  const formHabitacionesValido = configHabitacion.idFranquicia !== '' && configHabitacion.idSucursal !== '' && configHabitacion.cantidad > 0 && configHabitacion.numeroInicial !== '' && configHabitacion.precioBase > 0 && archivoHabitacion !== null;

  const guardarFranquicia = async (e) => {
    e.preventDefault();
    if (!formFranquiciaValido) return;
    try {
      await addDoc(collection(db, "Franquicias"), {
        ...nuevaFranquicia,
        curpDueño: nuevaFranquicia.curpDueño.toUpperCase()
      });
      setNuevaFranquicia({ nombreCorporativo: '', correoContacto: '', direccionPrincipal: '', nombreDueño: '', curpDueño: '', telefonoDueño: '' });
      cargarDatos();
      mostrarNotificacion("Franquicia corporativa registrada con éxito.");
    } catch (err) {
      console.error(err);
      mostrarNotificacion("Error al guardar la franquicia.", "error");
    }
  };

  const guardarSucursal = async (e) => {
    e.preventDefault();
    if (!formSucursalValido) return;
    setSubiendoFoto(true);
    try {
      const urlDescarga = await comprimirImagenABase64(archivoHotel);
      await addDoc(collection(db, "Sucursales"), { ...nuevaSucursal, fotoUrl: urlDescarga });
      setNuevaSucursal({
        idFranquicia: sesion.rol === 'Admin Franquicia' ? sesion.idFranquicia : '',
        nombre: '',
        ubicacion: { pais: '', estado: '', municipio: '', direccion: '', lat: '', lng: '' },
        moneda: 'MXN'
      });
      setArchivoHotel(null);
      const inputEl = document.getElementById('inputFotoHotel');
      if (inputEl) inputEl.value = "";
      cargarDatos();
      mostrarNotificacion("Hotel registrado y fotografía optimizada con éxito.");
    } catch (err) {
      console.error(err);
      mostrarNotificacion("Error guardando el hotel: " + err.message, "error");
    } finally {
      setSubiendoFoto(false);
    }
  };

  // Genera habitaciones empezando en 1 y continuando consecutivamente (2, 3, 4...)
  const generarHabitaciones = async (e) => {
    e.preventDefault();
    if (!formHabitacionesValido) return;
    setSubiendoFoto(true);
    try {
      const urlDescarga = await comprimirImagenABase64(archivoHabitacion);
      const cantidad = Math.max(1, parseInt(configHabitacion.cantidad, 10) || 1);
      const setOcupados = new Set(numerosHabitacionExistentes.map(n => parseInt(n, 10)));
      const nuevosNumerosCargados = [];

      let candidato = Math.max(1, parseInt(configHabitacion.numeroInicial, 10) || 1);

      for (let i = 0; i < cantidad; i++) {
        while (setOcupados.has(candidato)) {
          candidato += 1;
        }
        await addDoc(collection(db, "Habitaciones"), {
          numero: candidato.toString(),
          idSucursal: configHabitacion.idSucursal,
          tipo: configHabitacion.tipo,
          precioBase: Number(configHabitacion.precioBase),
          servicios: configHabitacion.servicios,
          estado: 'disponible',
          fotoUrl: urlDescarga
        });
        setOcupados.add(candidato);
        nuevosNumerosCargados.push(candidato);
        candidato += 1;
      }

      const todosLosNumeros = Array.from(setOcupados);
      setNumerosHabitacionExistentes(todosLosNumeros);
      const siguienteLibre = calcularSiguienteNumeroLibre(todosLosNumeros);

      setConfigHabitacion({
        ...configHabitacion,
        cantidad: 1,
        numeroInicial: siguienteLibre,
        tipo: 'Tradicional',
        precioBase: 1500,
        servicios: []
      });
      setArchivoHabitacion(null);
      const inputEl = document.getElementById('inputFotoHabitacion');
      if (inputEl) inputEl.value = "";
      await handleSucursalChange({ target: { value: configHabitacion.idSucursal } });
      mostrarNotificacion(`Se generaron ${nuevosNumerosCargados.length} habitación(es) (#${nuevosNumerosCargados.join(', #')}).`);
    } catch (err) {
      console.error(err);
      mostrarNotificacion("Error generando habitaciones: " + err.message, "error");
    } finally {
      setSubiendoFoto(false);
    }
  };

  const guardarPrecioHabitacion = async (idHab) => {
    const nuevoPrecio = Number(precioEditado);
    if (!nuevoPrecio || nuevoPrecio <= 0) {
      mostrarNotificacion("Ingresa un precio válido mayor a 0.", "error");
      return;
    }
    try {
      await updateDoc(doc(db, "Habitaciones", idHab), { precioBase: nuevoPrecio });
      setListaHabitaciones(prev => prev.map(h => h.id === idHab ? { ...h, precioBase: nuevoPrecio } : h));
      setEditandoHabId(null);
      mostrarNotificacion("Tarifa de habitación actualizada en tiempo real.");
    } catch (err) {
      console.error(err);
      mostrarNotificacion("No se pudo actualizar el precio.", "error");
    }
  };

  /**
   * ELIMINACIÓN TOTAL DE CUENTA DE HUÉSPED DESDE EL ADMIN:
   * 1. Cancela sus reservas activas y libera las habitaciones en tiempo real.
   * 2. Borra todas sus reservas de la colección 'Reservas' (su historial vuelve a cero).
   * 3. Borra todos sus documentos en 'Usuarios' (correo, nombre, CURP, teléfono).
   * 4. Registra el movimiento completo en 'Bitacora' para que quede auditoría permanente en el Admin.
   */
  const eliminarCuentaHuesped = async (huesped) => {
    const nombreH = huesped.nombre || 'Huésped';
    const correoH = (huesped.correo || '').trim().toLowerCase();
    const curpH = (huesped.curp || '').trim().toUpperCase();
    const uidH = huesped.uid || huesped.id;

    const confirmar = window.confirm(
      `¿Eliminar por completo la cuenta de "${nombreH}" (${correoH || curpH})?\n\n` +
      `• Si tiene reservas activas, se cancelarán y liberarán sus habitaciones automáticamente.\n` +
      `• Se borrará todo su historial de viajes, CURP y correo de Firebase para que pueda registrarse desde cero.\n` +
      `• Los movimientos quedarán resguardados en la Bitácora de Auditoría.`
    );
    if (!confirmar) return;

    setEliminandoHuespedId(huesped.id);
    try {
      // 1. Buscar todas las reservas vinculadas por UID, CURP o Correo
      const reservasMap = new Map();

      if (uidH) {
        const snapUid = await getDocs(query(collection(db, "Reservas"), where("uidUsuario", "==", uidH)));
        snapUid.docs.forEach(d => reservasMap.set(d.id, d.data()));
      }
      if (curpH) {
        const snapCurp = await getDocs(query(collection(db, "Reservas"), where("idUsuario", "==", curpH)));
        snapCurp.docs.forEach(d => reservasMap.set(d.id, d.data()));
      }
      if (correoH) {
        const snapCorreo = await getDocs(query(collection(db, "Reservas"), where("correoUsuario", "==", correoH)));
        snapCorreo.docs.forEach(d => reservasMap.set(d.id, d.data()));
      }

      // 2. Liberar habitaciones de reservas activas y eliminar todo el historial de Reservas
      let activasCanceladas = 0;
      const totalBorradas = reservasMap.size;

      for (const [resId, rData] of reservasMap.entries()) {
        if (rData.estado === 'Activa' && rData.idHabitacion) {
          activasCanceladas += 1;
          try {
            await updateDoc(doc(db, "Habitaciones", rData.idHabitacion), {
              estado: 'disponible',
              huespedNombre: null,
              huespedID: null,
              fechaEntrada: null,
              fechaSalida: null,
              totalActual: null,
              serviciosActuales: [],
              fechaIngreso: null,
              fechaSalidaReal: null
            });
          } catch (e) {
            // Ignorar si la habitación fue borrada previamente
          }
        }
        await deleteDoc(doc(db, "Reservas", resId));
      }

      // Liberar también cualquier habitación que tuviera asignado directamente su CURP
      if (curpH) {
        const snapHabsOcupadas = await getDocs(query(collection(db, "Habitaciones"), where("huespedID", "==", curpH)));
        for (const hDoc of snapHabsOcupadas.docs) {
          await updateDoc(doc(db, "Habitaciones", hDoc.id), {
            estado: 'disponible',
            huespedNombre: null,
            huespedID: null,
            fechaEntrada: null,
            fechaSalida: null,
            totalActual: null,
            serviciosActuales: [],
            fechaIngreso: null,
            fechaSalidaReal: null
          });
        }
      }

      // 3. Buscar y borrar todos los documentos del usuario en 'Usuarios' (por id, uid, curp y correo)
      const idsUsuariosABorrar = new Set([huesped.id]);
      if (uidH) idsUsuariosABorrar.add(uidH);
      if (curpH) {
        idsUsuariosABorrar.add(curpH);
        const snapUCurp = await getDocs(query(collection(db, "Usuarios"), where("curp", "==", curpH)));
        snapUCurp.docs.forEach(d => idsUsuariosABorrar.add(d.id));
      }
      if (correoH) {
        const snapUCorreo = await getDocs(query(collection(db, "Usuarios"), where("correo", "==", correoH)));
        snapUCorreo.docs.forEach(d => idsUsuariosABorrar.add(d.id));
      }

      for (const idDocU of idsUsuariosABorrar) {
        try {
          await deleteDoc(doc(db, "Usuarios", idDocU));
        } catch (e) {
          // Ignorar si no existe
        }
      }

      // 4. Guardar constancia inmutable en la Bitácora del Admin
      await addDoc(collection(db, "Bitacora"), {
        tipoAccion: 'ELIMINACIÓN',
        nombreEmpleado: sesion?.nombre || 'Administrador VIP',
        rolEmpleado: sesion?.rol || 'Admin VIP',
        detalles: `Cuenta de huésped eliminada: ${nombreH} | Correo: ${correoH || 'N/A'} | CURP: ${curpH || 'N/A'} | Historial depurado: ${totalBorradas} reserva(s) eliminada(s) (${activasCanceladas} activa(s) cancelada(s) y habitación liberada).`,
        fecha: serverTimestamp()
      });

      await cargarDatos();
      mostrarNotificacion(`Cuenta de ${nombreH} y todo su historial eliminados. Quedó registro en Bitácora.`);
    } catch (err) {
      console.error("Error al eliminar cuenta de huésped:", err);
      mostrarNotificacion("Error al eliminar la cuenta del huésped.", "error");
    } finally {
      setEliminandoHuespedId(null);
    }
  };

  const reqLongitud = nuevoEmpleado.password.length >= 8;
  const reqMayuscula = /[A-Z]/.test(nuevoEmpleado.password);
  const reqNumero = /[0-9]/.test(nuevoEmpleado.password);
  const reqSimbolo = /[^A-Za-z0-9]/.test(nuevoEmpleado.password);
  const curpStaffValida = nuevoEmpleado.curp.length === 0 || validarCurpMatematica(nuevoEmpleado.curp.toUpperCase());
  const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const correoValido = nuevoEmpleado.correo.length === 0 || regexCorreo.test(nuevoEmpleado.correo);
  const formStaffValido = reqLongitud && reqMayuscula && reqNumero && reqSimbolo && validarCurpMatematica(nuevoEmpleado.curp.toUpperCase()) && regexCorreo.test(nuevoEmpleado.correo);

  const guardarEmpleado = async (e) => {
    e.preventDefault();
    if (!formStaffValido) return;
    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, nuevoEmpleado.correo, nuevoEmpleado.password);
      await sendEmailVerification(userCredential.user);
      await addDoc(collection(db, "Personal"), {
        nombre: nuevoEmpleado.nombre,
        curp: nuevoEmpleado.curp.toUpperCase(),
        correo: nuevoEmpleado.correo,
        rol: nuevoEmpleado.rol,
        idFranquicia: nuevoEmpleado.idFranquicia,
        idSucursal: nuevoEmpleado.idSucursal,
        verificado: false
      });
      setNuevoEmpleado({
        nombre: '', curp: '', correo: '', password: '',
        rol: 'Recepcionista',
        idFranquicia: sesion.rol === 'Admin Franquicia' ? sesion.idFranquicia : '',
        idSucursal: ''
      });
      cargarDatos();
      mostrarNotificacion(`Staff registrado. Se envió correo de verificación a ${nuevoEmpleado.correo}`);
    } catch (err) {
      console.error(err);
      mostrarNotificacion("Error Auth: el correo ya está en uso o es inválido.", "error");
    }
  };

  const borrarDoc = async (coleccion, id) => {
    try {
      await deleteDoc(doc(db, coleccion, id));
      if (coleccion === 'Habitaciones') {
        await handleSucursalChange({ target: { value: configHabitacion.idSucursal } });
      } else {
        await cargarDatos();
      }
      mostrarNotificacion("Registro eliminado correctamente.");
    } catch (err) {
      console.error(err);
      mostrarNotificacion("No se pudo eliminar el registro.", "error");
    }
  };

  const toggleServicio = (servicio) => {
    setConfigHabitacion(prev => ({
      ...prev,
      servicios: prev.servicios.includes(servicio)
        ? prev.servicios.filter(s => s !== servicio)
        : [...prev.servicios, servicio]
    }));
  };

  const obtenerNombreSucursal = (id) => listaSucursales.find(s => s.id === id)?.nombre || 'N/A';
  const obtenerNombreFranquicia = (id) => listaFranquicias.find(f => f.id === id)?.nombreCorporativo || 'N/A';

  return (
    <div className="page-container" style={{ position: 'relative' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          background: toast.tipo === 'error' ? '#fef2f2' : '#f0fdf4',
          color: toast.tipo === 'error' ? '#b91c1c' : '#15803d',
          border: `1px solid ${toast.tipo === 'error' ? '#fecaca' : '#bbf7d0'}`,
          padding: '14px 20px', borderRadius: '12px',
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.12)',
          display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '600', fontSize: '14px'
        }}>
          {toast.tipo === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.mensaje}</span>
        </div>
      )}

      <div className="header-seccion" style={{ marginBottom: '20px' }}>
        <h2 style={{ color: '#0f172a', margin: '0 0 4px 0', fontSize: '24px', fontWeight: '800' }}>Catálogos y Configuración Core</h2>
        <p style={{ color: '#64748b', margin: 0, fontSize: '14px' }}>Administración de franquicias, hoteles, inventario consecutivo de habitaciones (#1, #2, #3...) y directorio de cuentas.</p>
      </div>

      <div className="tabs-container" style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', marginBottom: '24px', flexWrap: 'wrap' }}>
        {[
          { id: 'franquicias', label: '1. Franquicias' },
          { id: 'sucursales', label: '2. Hoteles (Fotos/Mapa)' },
          { id: 'habitaciones', label: '3. Habitaciones y Tarifas' },
          { id: 'personal', label: '4. Staff' },
          { id: 'huespedes', label: '5. Directorio Huéspedes' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setPestañaActiva(tab.id)}
            style={{
              padding: '12px 18px', background: pestañaActiva === tab.id ? '#f0f9ff' : 'none',
              border: 'none', borderBottom: pestañaActiva === tab.id ? '3px solid #0284c7' : '3px solid transparent',
              borderRadius: '8px 8px 0 0', cursor: 'pointer',
              color: pestañaActiva === tab.id ? '#0284c7' : '#64748b',
              fontWeight: pestañaActiva === tab.id ? '700' : '600', fontSize: '14px', transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {pestañaActiva === 'franquicias' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="card-formulario" style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <form onSubmit={guardarFranquicia} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <input type="text" placeholder="Nombre Corporativo" onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, nombreCorporativo: e.target.value })} value={nuevaFranquicia.nombreCorporativo} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <div>
                <input type="email" placeholder="Correo Oficial" onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, correoContacto: e.target.value })} value={nuevaFranquicia.correoContacto} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: nuevaFranquicia.correoContacto.length > 0 ? (correoFranquiciaValido ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                {nuevaFranquicia.correoContacto.length > 0 && !correoFranquiciaValido && <span style={{ fontSize: '11px', color: '#ef4444' }}>Formato de correo inválido.</span>}
              </div>
              <input type="text" placeholder="Dirección Fiscal Principal" onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, direccionPrincipal: e.target.value })} value={nuevaFranquicia.direccionPrincipal} style={{ gridColumn: 'span 2', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="text" placeholder="CURP del Dueño (18 caracteres)" maxLength={18} onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, curpDueño: e.target.value.toUpperCase() })} value={nuevaFranquicia.curpDueño} style={{ padding: '12px', borderRadius: '8px', border: nuevaFranquicia.curpDueño.length > 0 ? (curpDueñoValida ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1', textTransform: 'uppercase' }} />
              <input type="text" placeholder="Nombre Completo del Dueño" onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, nombreDueño: e.target.value })} value={nuevaFranquicia.nombreDueño} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <input type="tel" placeholder="Teléfono del Dueño (10 dígitos)" maxLength={10} onChange={e => setNuevaFranquicia({ ...nuevaFranquicia, telefonoDueño: e.target.value.replace(/\D/g, '') })} value={nuevaFranquicia.telefonoDueño} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              <button type="submit" disabled={!formFranquiciaValido} style={{ background: formFranquiciaValido ? '#0284c7' : '#cbd5e1', color: 'white', padding: '12px 20px', borderRadius: '8px', border: 'none', cursor: formFranquiciaValido ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>Guardar Franquicia</button>
            </form>
          </div>
          <div className="card-tabla" style={{ background: 'white', padding: '24px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '12px', color: '#16a34a', background: '#dcfce7', padding: '5px 12px', borderRadius: '999px', fontWeight: '700' }}>✓ Registro Corporativo</span>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '15px' }}>
              <thead><tr style={{ borderBottom: '2px solid #f1f5f9' }}><th>ID Sistema</th><th>Empresa Corporativa</th><th>Contacto</th><th>Dueño</th></tr></thead>
              <tbody>
                {listaFranquicias.map(f => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8' }}>{f.id}</td>
                    <td style={{ fontWeight: 'bold' }}>{f.nombreCorporativo}</td>
                    <td>{f.correoContacto}</td>
                    <td>{f.nombreDueño || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pestañaActiva === 'sucursales' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="card-formulario" style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <h3 style={{ margin: '0 0 5px 0', color: '#0f172a' }}>Registrar Hotel (Geolocalización y Compresión Web)</h3>
            <form onSubmit={guardarSucursal} style={{ display: 'grid', gap: '15px', marginTop: '15px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <select onChange={e => setNuevaSucursal({ ...nuevaSucursal, idFranquicia: e.target.value })} value={nuevaSucursal.idFranquicia} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} disabled={sesion.rol === 'Admin Franquicia'}>
                  <option value="">Selecciona Franquicia...</option>
                  {listaFranquicias.map(f => <option key={f.id} value={f.id}>{f.nombreCorporativo}</option>)}
                </select>
                <input type="text" placeholder="Nombre Comercial del Hotel" onChange={e => setNuevaSucursal({ ...nuevaSucursal, nombre: e.target.value })} value={nuevaSucursal.nombre} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
              </div>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '10px', border: '1px dashed #94a3b8', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ImageIcon color="#0284c7" />
                <label style={{ fontSize: '13px', color: '#475569', flex: 1 }}>Fotografía de Fachada (Se optimiza automáticamente para baja latencia):</label>
                <input id="inputFotoHotel" type="file" accept="image/*" onChange={(e) => setArchivoHotel(e.target.files[0])} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <select onChange={e => setNuevaSucursal({ ...nuevaSucursal, ubicacion: { ...nuevaSucursal.ubicacion, pais: e.target.value, estado: '', municipio: '' } })} value={nuevaSucursal.ubicacion.pais} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}><option value="">País</option>{Object.keys(catalogoUbicaciones).map(p => <option key={p} value={p}>{p}</option>)}</select>
                <select disabled={!nuevaSucursal.ubicacion.pais} onChange={e => setNuevaSucursal({ ...nuevaSucursal, ubicacion: { ...nuevaSucursal.ubicacion, estado: e.target.value, municipio: '' } })} value={nuevaSucursal.ubicacion.estado} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}><option value="">Estado</option>{nuevaSucursal.ubicacion.pais && Object.keys(catalogoUbicaciones[nuevaSucursal.ubicacion.pais] || {}).map(est => <option key={est} value={est}>{est}</option>)}</select>
                <select disabled={!nuevaSucursal.ubicacion.estado} onChange={e => setNuevaSucursal({ ...nuevaSucursal, ubicacion: { ...nuevaSucursal.ubicacion, municipio: e.target.value } })} value={nuevaSucursal.ubicacion.municipio} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}><option value="">Municipio</option>{nuevaSucursal.ubicacion.estado && (catalogoUbicaciones[nuevaSucursal.ubicacion.pais]?.[nuevaSucursal.ubicacion.estado] || []).map(m => <option key={m} value={m}>{m}</option>)}</select>
              </div>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'grid', gap: '10px' }}>
                <input type="text" placeholder="Dirección Exacta (Calle, Número, C.P.)" onChange={e => setNuevaSucursal({ ...nuevaSucursal, ubicacion: { ...nuevaSucursal.ubicacion, direccion: e.target.value } })} value={nuevaSucursal.ubicacion.direccion} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', width: '100%', boxSizing: 'border-box' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                  <input type="text" readOnly placeholder="Latitud" value={nuevaSucursal.ubicacion.lat} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569' }} />
                  <input type="text" readOnly placeholder="Longitud" value={nuevaSucursal.ubicacion.lng} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569' }} />
                  <button type="button" onClick={() => setMostrarMapa(true)} style={{ background: '#0284c7', color: 'white', border: 'none', padding: '12px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={16} /> Seleccionar en Mapa
                  </button>
                </div>
              </div>
              <button type="submit" disabled={!formSucursalValido || subiendoFoto} style={{ padding: '14px', background: formSucursalValido && !subiendoFoto ? '#0284c7' : '#cbd5e1', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: formSucursalValido && !subiendoFoto ? 'pointer' : 'not-allowed' }}>
                {subiendoFoto ? 'Optimizando fotografía y guardando...' : 'Guardar Hotel'}
              </button>
            </form>
          </div>
          <div className="card-tabla" style={{ background: 'white', padding: '24px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead><tr style={{ borderBottom: '2px solid #e2e8f0' }}><th style={{ padding: '10px' }}>Hotel</th><th>Ubicación</th><th>Franquicia</th><th>Foto</th><th>Acción</th></tr></thead>
              <tbody>
                {listaSucursales.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{s.nombre}</td>
                    <td style={{ fontSize: '13px', color: '#64748b' }}>{[s.ubicacion?.municipio, s.ubicacion?.estado].filter(Boolean).join(', ')}</td>
                    <td style={{ color: '#0284c7', fontWeight: '600' }}>{obtenerNombreFranquicia(s.idFranquicia)}</td>
                    <td>{s.fotoUrl ? <img src={s.fotoUrl} alt="Hotel" style={{ width: '56px', height: '36px', objectFit: 'cover', borderRadius: '6px' }} /> : 'Sin foto'}</td>
                    <td>
                      <button onClick={() => borrarDoc('Sucursales', s.id)} title="Eliminar sucursal" style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pestañaActiva === 'habitaciones' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="card-formulario" style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <form onSubmit={generarHabitaciones} style={{ display: 'grid', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <select onChange={e => setConfigHabitacion({ ...configHabitacion, idFranquicia: e.target.value, idSucursal: '' })} value={configHabitacion.idFranquicia} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} disabled={sesion.rol === 'Admin Franquicia'}>
                  <option value="">Selecciona Franquicia...</option>
                  {listaFranquicias.map(f => <option key={f.id} value={f.id}>{f.nombreCorporativo}</option>)}
                </select>
                <select value={configHabitacion.idSucursal} onChange={handleSucursalChange} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  <option value="">Selecciona Hotel Destino...</option>
                  {listaSucursales.filter(s => s.idFranquicia === configHabitacion.idFranquicia).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '10px', border: '1px dashed #94a3b8', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ImageIcon color="#0284c7" />
                <label style={{ fontSize: '13px', color: '#475569', flex: 1 }}>Fotografía prototipo de la habitación (Compresión automática):</label>
                <input id="inputFotoHabitacion" type="file" accept="image/*" onChange={(e) => setArchivoHabitacion(e.target.files[0])} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px', background: '#f8fafc', padding: '15px', borderRadius: '10px' }}>
                <div><label style={{ fontSize: '12px', fontWeight: 'bold' }}>Cantidad</label><input type="number" min="1" max="50" value={configHabitacion.cantidad} onChange={e => setConfigHabitacion({ ...configHabitacion, cantidad: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} /></div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Siguiente N° Disponible</label>
                  <input type="number" value={configHabitacion.numeroInicial} readOnly style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f1f5f9', color: '#0284c7', cursor: 'not-allowed', fontWeight: '800' }} title="Inicia en 1 y continúa automáticamente en 2, 3..." />
                </div>
                <div><label style={{ fontSize: '12px', fontWeight: 'bold' }}>Categoría</label><select onChange={e => setConfigHabitacion({ ...configHabitacion, tipo: e.target.value })} value={configHabitacion.tipo} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>{TIPOS_HABITACION.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><label style={{ fontSize: '12px', fontWeight: 'bold' }}>Precio Base (MXN)</label><input type="number" min="1" value={configHabitacion.precioBase} onChange={e => setConfigHabitacion({ ...configHabitacion, precioBase: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }} /></div>
              </div>
              <div>
                <p style={{ fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px' }}>Amenidades incluidas (Visibles en la App Móvil)</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
                  {SERVICIOS_DISPONIBLES.map(s => (
                    <label key={s} style={{ fontSize: '13px', display: 'flex', gap: '8px', alignItems: 'center', background: configHabitacion.servicios.includes(s) ? '#e0f2fe' : 'white', border: configHabitacion.servicios.includes(s) ? '1px solid #38bdf8' : '1px solid #e2e8f0', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={configHabitacion.servicios.includes(s)} onChange={() => toggleServicio(s)} style={{ accentColor: '#0284c7' }} /> {s}
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" disabled={!formHabitacionesValido || subiendoFoto} style={{ padding: '15px', background: formHabitacionesValido && !subiendoFoto ? '#0284c7' : '#cbd5e1', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 'bold', cursor: formHabitacionesValido && !subiendoFoto ? 'pointer' : 'not-allowed' }}>
                {subiendoFoto ? 'Optimizando foto y generando inventario...' : `Generar Habitación(es) desde #${configHabitacion.numeroInicial}`}
              </button>
            </form>
          </div>

          {configHabitacion.idSucursal && (
            <div className="card-tabla" style={{ background: 'white', padding: '24px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <h3 style={{ margin: '0 0 15px 0', fontSize: '16px', color: '#0f172a' }}>
                Inventario actual en {obtenerNombreSucursal(configHabitacion.idSucursal)} ({listaHabitaciones.length} habitaciones)
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                    <th style={{ padding: '10px' }}>Habitación</th>
                    <th>Categoría</th>
                    <th>Estado Hoy</th>
                    <th>Tarifa por Noche</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {listaHabitaciones.map(h => (
                    <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', fontWeight: '800' }}>#{h.numero}</td>
                      <td>{h.tipo}</td>
                      <td>
                        <span style={{
                          padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 'bold',
                          background: h.estado === 'disponible' ? '#dcfce7' : h.estado === 'ocupado' ? '#fee2e2' : '#fef9c3',
                          color: h.estado === 'disponible' ? '#15803d' : h.estado === 'ocupado' ? '#b91c1c' : '#a16207'
                        }}>
                          {h.estado?.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {editandoHabId === h.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="number"
                              value={precioEditado}
                              onChange={e => setPrecioEditado(e.target.value)}
                              style={{ width: '90px', padding: '6px', borderRadius: '6px', border: '1px solid #0284c7' }}
                            />
                            <button onClick={() => guardarPrecioHabitacion(h.id)} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                              <Save size={14} /> Guardar
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontWeight: '700', color: '#0f172a' }}>${Number(h.precioBase || 0).toLocaleString()} MXN</span>
                        )}
                      </td>
                      <td style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px' }}>
                        <button
                          onClick={() => { setEditandoHabId(h.id); setPrecioEditado(h.precioBase); }}
                          title="Editar tarifa"
                          style={{ color: '#0284c7', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          onClick={() => borrarDoc('Habitaciones', h.id)}
                          title="Eliminar habitación"
                          style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {pestañaActiva === 'personal' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          <div className="card-formulario" style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <form onSubmit={guardarEmpleado} style={{ display: 'grid', gap: '15px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <input type="text" placeholder="Nombre Completo del Staff" value={nuevoEmpleado.nombre} onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, nombre: e.target.value })} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                <input type="text" placeholder="CURP (18 caracteres)" maxLength={18} value={nuevoEmpleado.curp} onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, curp: e.target.value.toUpperCase() })} style={{ padding: '12px', borderRadius: '8px', border: nuevoEmpleado.curp.length > 0 ? (curpStaffValida ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1', textTransform: 'uppercase' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div>
                  <input type="email" placeholder="Correo Oficial" value={nuevoEmpleado.correo} onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, correo: e.target.value })} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: nuevoEmpleado.correo.length > 0 ? (correoValido ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                  {nuevoEmpleado.correo.length > 0 && !correoValido && <span style={{ fontSize: '10px', color: '#ef4444' }}>Formato requerido: usuario@empresa.com</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <input type="text" placeholder="Contraseña Segura" value={nuevoEmpleado.password} onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, password: e.target.value })} style={{ padding: '12px', borderRadius: '8px', border: reqLongitud && reqMayuscula && reqNumero && reqSimbolo ? '2px solid #22c55e' : '1px solid #cbd5e1', outline: 'none' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', marginTop: '4px', background: '#f8fafc', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <span style={{ color: reqLongitud ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>{reqLongitud ? '✓' : '✗'} 8+ Caracteres</span>
                    <span style={{ color: reqMayuscula ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>{reqMayuscula ? '✓' : '✗'} 1 Mayúscula</span>
                    <span style={{ color: reqNumero ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>{reqNumero ? '✓' : '✗'} 1 Número</span>
                    <span style={{ color: reqSimbolo ? '#16a34a' : '#ef4444', fontWeight: 'bold' }}>{reqSimbolo ? '✓' : '✗'} 1 Símbolo especial</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <select onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, rol: e.target.value })} value={nuevoEmpleado.rol} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  <option value="Recepcionista">Recepcionista</option>
                  <option value="Staff Limpieza">Staff Limpieza</option>
                  {sesion.rol === 'Admin VIP' && <option value="Admin Franquicia">Admin Franquicia</option>}
                  {sesion.rol === 'Admin VIP' && <option value="Admin VIP">Admin VIP</option>}
                </select>
                <select onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, idFranquicia: e.target.value })} value={nuevoEmpleado.idFranquicia} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }} disabled={sesion.rol === 'Admin Franquicia'}>
                  <option value="">Franquicia...</option>
                  {listaFranquicias.map(f => <option key={f.id} value={f.id}>{f.nombreCorporativo}</option>)}
                </select>
                <select disabled={!nuevoEmpleado.idFranquicia} onChange={e => setNuevoEmpleado({ ...nuevoEmpleado, idSucursal: e.target.value })} value={nuevoEmpleado.idSucursal} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                  <option value="">Hotel asignado...</option>
                  {listaSucursales.filter(s => s.idFranquicia === nuevoEmpleado.idFranquicia).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <button type="submit" disabled={!formStaffValido} style={{ padding: '15px', background: formStaffValido ? '#0284c7' : '#cbd5e1', color: 'white', borderRadius: '8px', border: 'none', cursor: formStaffValido ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}>
                Registrar Staff y Enviar Verificación
              </button>
            </form>
          </div>
          <div className="card-tabla" style={{ background: 'white', padding: '24px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead><tr style={{ borderBottom: '2px solid #f1f5f9' }}><th style={{ padding: '10px' }}>Staff</th><th>Rol</th><th>Hotel</th><th>Verificación</th><th>Acción</th></tr></thead>
              <tbody>
                {listaPersonal.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px' }}><strong>{p.nombre}</strong><br /><span style={{ fontSize: '11px', color: '#64748b' }}>{p.curp}</span></td>
                    <td><span style={{ fontSize: '11px', background: '#e2e8f0', padding: '4px 10px', borderRadius: '999px', fontWeight: 'bold' }}>{p.rol}</span></td>
                    <td>{obtenerNombreSucursal(p.idSucursal)}</td>
                    <td><span style={{ background: p.verificado ? '#dcfce7' : '#fee2e2', color: p.verificado ? '#166534' : '#dc2626', padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 'bold' }}>{p.verificado ? 'Verificado' : 'Pendiente Mail'}</span></td>
                    <td><button onClick={() => borrarDoc('Personal', p.id)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pestañaActiva === 'huespedes' && (
        <div style={{ background: 'white', padding: '25px', borderRadius: '14px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
          <div style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: '0 0 4px 0', color: '#0f172a', fontSize: '17px' }}>Directorio de Cuentas y Huéspedes</h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Cada CURP está vinculada a su correo. Si eliminas una cuenta aquí, se cancelan sus reservas activas, se borra todo su historial en Firebase y queda registro en la Bitácora.
              </p>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                <th style={{ padding: '12px' }}>Cliente</th>
                <th>Correo Asociado</th>
                <th>Teléfono</th>
                <th>CURP Vinculada</th>
                <th>Reservas / Nivel</th>
                <th style={{ textAlign: 'center' }}>Eliminar Cuenta</th>
              </tr>
            </thead>
            <tbody>
              {listaHuespedes.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                    No hay huéspedes registrados actualmente.
                  </td>
                </tr>
              ) : (
                listaHuespedes.map(h => {
                  const numReservas = h.reservasReales ?? 0;
                  const esVip = numReservas > 5;
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: '#0f172a' }}>{h.nombre || 'Sin nombre'}</td>
                      <td style={{ color: '#0284c7', fontWeight: '600', fontSize: '13px' }}>{h.correo || 'N/A'}</td>
                      <td>{h.telefono || 'Sin registrar'}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: '700', color: h.curp ? '#0f172a' : '#94a3b8' }}>
                        {h.curp || 'Sin CURP aún'}
                      </td>
                      <td>
                        <span style={{
                          background: esVip ? '#dcfce7' : numReservas > 0 ? '#e0f2fe' : '#f1f5f9',
                          color: esVip ? '#166534' : numReservas > 0 ? '#0369a1' : '#64748b',
                          padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 'bold'
                        }}>
                          {esVip ? `★ VIP (${numReservas} reservas)` : `${numReservas} ${numReservas === 1 ? 'estancia' : 'estancias'}`}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px' }}>
                        <button
                          onClick={() => eliminarCuentaHuesped(h)}
                          disabled={eliminandoHuespedId === h.id}
                          title="Eliminar cuenta, cancelar reservas activas y limpiar historial"
                          style={{
                            background: '#fef2f2',
                            color: '#dc2626',
                            border: '1px solid #fecaca',
                            padding: '6px 12px',
                            borderRadius: '8px',
                            cursor: eliminandoHuespedId === h.id ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '12px',
                            fontWeight: '700'
                          }}
                        >
                          <Trash2 size={14} />
                          {eliminandoHuespedId === h.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {mostrarMapa && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: 'white', padding: '20px', borderRadius: '14px', width: '90%', maxWidth: '700px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px' }}>Ubicación Global del Hotel</h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Haz clic en el mapa para colocar el marcador en la ubicación exacta.</p>
              </div>
              <button onClick={() => setMostrarMapa(false)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <X size={18} color="#475569" />
              </button>
            </div>
            <div style={{ height: '400px', width: '100%', borderRadius: '10px', overflow: 'hidden', border: '2px solid #e2e8f0', zIndex: 1 }}>
              <MapContainer center={[16.7569, -93.1292]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <MapClicker coordsTemp={coordsTemp} setCoordsTemp={setCoordsTemp} />
              </MapContainer>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', background: '#f8fafc', padding: '15px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ background: 'white', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#334155', fontWeight: 'bold' }}>Lat: <span style={{ color: '#0284c7' }}>{coordsTemp.lat.toFixed(6)}</span></div>
                <div style={{ background: 'white', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', color: '#334155', fontWeight: 'bold' }}>Lng: <span style={{ color: '#0284c7' }}>{coordsTemp.lng.toFixed(6)}</span></div>
              </div>
              <button onClick={confirmarUbicacion} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                Confirmar Coordenadas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Catalogos;
