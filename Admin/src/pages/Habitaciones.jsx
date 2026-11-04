import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc, addDoc, increment, serverTimestamp, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, User, X, CheckCircle2, LogOut, Eraser, Receipt, MapPin, Building, AlertTriangle, Calendar, AlertCircle, Ban, BedDouble, CalendarPlus } from 'lucide-react';

// Validación oficial de estructura RENAPO de 18 caracteres sin falsos rechazos por dígito verificador
const validarCurpMatematica = (curp) => {
  const curpLimpia = String(curp || '').trim().toUpperCase();
  if (curpLimpia.length !== 18) return false;
  const regex = /^[A-ZÑ]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HMX][A-Z]{2}[A-ZÑ]{3}[0-9A-Z]\d$/;
  return regex.test(curpLimpia);
};

const obtenerFechaLocalISO = (fecha = new Date()) => {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
};

const sumarDiasISO = (fechaISO, dias = 1) => {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return obtenerFechaLocalISO(dt);
};

function Habitaciones() {
  const hoyInicialISO = obtenerFechaLocalISO(new Date());
  const mananaInicialISO = sumarDiasISO(hoyInicialISO, 1);

  const [habitaciones, setHabitaciones] = useState([]);
  const [reservasActivas, setReservasActivas] = useState([]);
  const [usuariosRegistrados, setUsuariosRegistrados] = useState([]);
  const [listaFranquicias, setListaFranquicias] = useState([]);
  const [listaSucursales, setListaSucursales] = useState([]);
  const [mapaSucursales, setMapaSucursales] = useState({});
  const [filtroFranquicia, setFiltroFranquicia] = useState('TODAS');
  const [filtroSucursal, setFiltroSucursal] = useState('TODAS');
  const [relojActual, setRelojActual] = useState(new Date());

  const [habSeleccionada, setHabSeleccionada] = useState(null);
  const [modo, setModo] = useState('');
  const [formData, setFormData] = useState({
    nombre: '',
    curp: '',
    correo: '',
    telefono: '',
    fechaEntrada: hoyInicialISO,
    fechaSalida: mananaInicialISO
  });
  const [conflictoCurpCorreo, setConflictoCurpCorreo] = useState('');
  const [habitacionSecuestrada, setHabitacionSecuestrada] = useState(false);
  const [toast, setToast] = useState(null);

  const sesionEmpleado = JSON.parse(localStorage.getItem('sesionSkyStay')) || JSON.parse(localStorage.getItem('sesionXone'));
  const esAdmin = sesionEmpleado?.rol === 'Admin VIP';

  const mostrarNotificacion = (mensaje, tipo = 'exito') => {
    setToast({ mensaje, tipo });
    setTimeout(() => setToast(null), 4000);
  };

  // Cargar nombres de hoteles, franquicias y escuchar usuarios para autocompletar CURP <-> Correo
  useEffect(() => {
    const cargarMetadatos = async () => {
      try {
        const [snapFranquicias, snapSucursales] = await Promise.all([
          getDocs(collection(db, "Franquicias")),
          getDocs(collection(db, "Sucursales"))
        ]);
        const sucs = snapSucursales.docs.map(d => ({ id: d.id, ...d.data() }));
        const mapa = {};
        sucs.forEach(s => { mapa[s.id] = s.nombre; });

        setListaFranquicias(snapFranquicias.docs.map(d => ({ id: d.id, ...d.data() })));
        setListaSucursales(sucs);
        setMapaSucursales(mapa);
      } catch (err) {
        console.error("Error cargando metadatos:", err);
      }
    };
    cargarMetadatos();

    const unsubUsuarios = onSnapshot(collection(db, "Usuarios"), (snap) => {
      setUsuariosRegistrados(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const unsubReservas = onSnapshot(
      query(collection(db, "Reservas"), where("estado", "==", "Activa")),
      (snap) => {
        setReservasActivas(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    );

    return () => {
      unsubUsuarios();
      unsubReservas();
    };
  }, []);

  // Auto-migración en segundo plano si quedaban habitaciones con numeración 101, 102... a 1, 2...
  useEffect(() => {
    if (habitaciones.length === 0) return;
    const tieneMayoresA100 = habitaciones.some(h => parseInt(h.numero, 10) >= 101);
    if (!tieneMayoresA100) return;

    const migrar = async () => {
      const porSucursal = {};
      habitaciones.forEach(h => {
        const sId = h.idSucursal || 'GENERAL';
        if (!porSucursal[sId]) porSucursal[sId] = [];
        porSucursal[sId].push(h);
      });

      for (const sId of Object.keys(porSucursal)) {
        const lista = porSucursal[sId].sort((a, b) => parseInt(a.numero, 10) - parseInt(b.numero, 10));
        const usados = new Set();
        lista.forEach(h => {
          const n = parseInt(h.numero, 10);
          if (!Number.isNaN(n) && n >= 1 && n < 101) usados.add(n);
        });
        for (const h of lista) {
          const n = parseInt(h.numero, 10);
          if (Number.isNaN(n) || n >= 101) {
            let candidato = 1;
            while (usados.has(candidato)) candidato += 1;
            usados.add(candidato);
            const nuevoStr = String(candidato);
            await updateDoc(doc(db, "Habitaciones", h.id), { numero: nuevoStr });
            const snapR = await getDocs(query(collection(db, "Reservas"), where("idHabitacion", "==", h.id)));
            for (const rDoc of snapR.docs) {
              await updateDoc(doc(db, "Reservas", rDoc.id), { numeroHabitacion: nuevoStr });
            }
          }
        }
      }
    };
    migrar().catch(console.error);
  }, [habitaciones]);

  /**
   * MOTOR DE SINCRONIZACIÓN AUTOMÁTICA DE RELOJ EN TIEMPO REAL:
   * - Al cumplirse la fecha de salida a las 12:00 hrs -> la reserva pasa a 'Completada' y la habitación a 'mantenimiento' (limpieza).
   * - A las 15:00 hrs (3:00 PM) -> las habitaciones en 'mantenimiento' pasan automáticamente a 'disponible'
   *   (o a 'ocupado' si tienen una reserva activa para el día de hoy).
   */
  const sincronizarCicloHorario = useCallback(async () => {
    const ahora = new Date();
    const hoyISO = obtenerFechaLocalISO(ahora);
    const horaActual = ahora.getHours();

    if (habitaciones.length === 0) return;

    try {
      const reservasHoyPorHab = new Map();

      for (const res of reservasActivas) {
        const salida = res.fechaSalida || '';
        const entrada = res.fechaEntrada || '';

        const vencioDiaAnterior = salida && salida < hoyISO;
        const vencioHoyMediodia = salida === hoyISO && horaActual >= 12;

        if (vencioDiaAnterior || vencioHoyMediodia) {
          await updateDoc(doc(db, "Reservas", res.id), {
            estado: 'Completada',
            fechaSalidaReal: serverTimestamp()
          });
        } else {
          const ocupaHoy =
            entrada <= hoyISO &&
            salida > hoyISO &&
            (entrada < hoyISO || horaActual >= 15 || res.metodoPago === 'Recepción Directa');
          if (ocupaHoy && res.idHabitacion) {
            reservasHoyPorHab.set(res.idHabitacion, res);
          }
        }
      }

      for (const hab of habitaciones) {
        const resHoy = reservasHoyPorHab.get(hab.id);
        const salidaHab = hab.fechaSalida || '';

        if (hab.estado === 'ocupado') {
          const salioDiaAnterior = salidaHab && salidaHab < hoyISO;
          const salioHoyMediodia = salidaHab === hoyISO && horaActual >= 12;

          if (salioDiaAnterior || salioHoyMediodia) {
            if (salioHoyMediodia && horaActual < 15) {
              // Entre 12:00 PM y 14:59 PM cambia automáticamente a mantenimiento (limpieza)
              await updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: 'mantenimiento',
                fechaMantenimientoISO: hoyISO,
                fechaSalidaReal: serverTimestamp()
              });
            } else if (resHoy) {
              await updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: 'ocupado',
                huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || 'Huésped',
                huespedID: resHoy.idUsuario || '',
                fechaEntrada: resHoy.fechaEntrada,
                fechaSalida: resHoy.fechaSalida,
                totalActual: resHoy.totalGenerado || hab.precioBase
              });
            } else {
              // Pasadas las 15:00 hrs pasa automáticamente a disponible
              await updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: 'disponible',
                huespedNombre: null,
                huespedID: null,
                fechaEntrada: null,
                fechaSalida: null,
                totalActual: null,
                fechaIngreso: null
              });
            }
          } else if (hab.fechaEntrada && hab.fechaEntrada > hoyISO && !resHoy) {
            // Si la reserva que tenía anotada es para un día futuro, HOY la habitación está disponible
            await updateDoc(doc(db, "Habitaciones", hab.id), {
              estado: 'disponible',
              huespedNombre: null,
              huespedID: null,
              fechaEntrada: null,
              fechaSalida: null,
              totalActual: null,
              fechaIngreso: null
            });
          }
        } else if (hab.estado === 'mantenimiento') {
          // A las 3:00 PM (15:00 hrs) pasa automáticamente a disponible (o a ocupado si entra alguien hoy)
          const fechaMant = hab.fechaMantenimientoISO || hoyISO;
          if (horaActual >= 15 || fechaMant < hoyISO) {
            if (resHoy) {
              await updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: 'ocupado',
                huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || 'Huésped',
                huespedID: resHoy.idUsuario || '',
                fechaEntrada: resHoy.fechaEntrada,
                fechaSalida: resHoy.fechaSalida,
                totalActual: resHoy.totalGenerado || hab.precioBase
              });
            } else {
              await updateDoc(doc(db, "Habitaciones", hab.id), {
                estado: 'disponible',
                huespedNombre: null,
                huespedID: null,
                fechaEntrada: null,
                fechaSalida: null,
                totalActual: null,
                fechaIngreso: null,
                fechaMantenimientoISO: null
              });
            }
          }
        } else if (hab.estado === 'disponible' && resHoy) {
          await updateDoc(doc(db, "Habitaciones", hab.id), {
            estado: 'ocupado',
            huespedNombre: resHoy.nombreUsuario || resHoy.huespedNombre || 'Huésped',
            huespedID: resHoy.idUsuario || '',
            fechaEntrada: resHoy.fechaEntrada,
            fechaSalida: resHoy.fechaSalida,
            totalActual: resHoy.totalGenerado || hab.precioBase
          });
        }
      }
    } catch (e) {
      console.error("Error sincronizando ciclo horario:", e);
    }
  }, [habitaciones, reservasActivas]);

  // Reloj en vivo segundo a segundo + disparo del sincronizador horario cada 20 segundos
  useEffect(() => {
    const timerReloj = setInterval(() => {
      setRelojActual(new Date());
    }, 1000);

    sincronizarCicloHorario();
    const timerSync = setInterval(() => {
      sincronizarCicloHorario();
    }, 20000);

    return () => {
      clearInterval(timerReloj);
      clearInterval(timerSync);
    };
  }, [sincronizarCicloHorario]);

  const sucursalesFiltradas = useMemo(() => {
    if (filtroFranquicia === 'TODAS') return listaSucursales;
    return listaSucursales.filter(s => s.idFranquicia === filtroFranquicia);
  }, [filtroFranquicia, listaSucursales]);

  useEffect(() => {
    if (!sesionEmpleado) return;

    let q;
    if (esAdmin) {
      if (filtroSucursal !== 'TODAS') {
        q = query(collection(db, "Habitaciones"), where("idSucursal", "==", filtroSucursal));
      } else if (filtroFranquicia !== 'TODAS') {
        const ids = sucursalesFiltradas.map(s => s.id);
        if (ids.length === 0) return;
        q = query(collection(db, "Habitaciones"), where("idSucursal", "in", ids));
      } else {
        q = collection(db, "Habitaciones");
      }
    } else {
      q = query(collection(db, "Habitaciones"), where("idSucursal", "==", sesionEmpleado.idSucursal));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHabitaciones(docs.sort((a, b) => String(a.numero).localeCompare(String(b.numero), undefined, { numeric: true })));
    });

    return () => unsubscribe();
  }, [sesionEmpleado?.idSucursal, esAdmin, filtroFranquicia, filtroSucursal, sucursalesFiltradas]);

  const habitacionesVisuales = useMemo(() => {
    if (esAdmin && filtroFranquicia !== 'TODAS' && sucursalesFiltradas.length === 0) return [];

    let filtradas = habitaciones;
    if (esAdmin) {
      if (filtroFranquicia !== 'TODAS') {
        const ids = sucursalesFiltradas.map(s => s.id);
        filtradas = filtradas.filter(h => ids.includes(h.idSucursal));
      }
      if (filtroSucursal !== 'TODAS') {
        filtradas = filtradas.filter(h => h.idSucursal === filtroSucursal);
      }
    }
    return filtradas;
  }, [habitaciones, esAdmin, filtroFranquicia, filtroSucursal, sucursalesFiltradas]);

  // Reservas activas de la habitación actualmente seleccionada en el modal
  const reservasDeHabSeleccionada = useMemo(() => {
    if (!habSeleccionada) return [];
    return reservasActivas
      .filter(r => r.idHabitacion === habSeleccionada.id && r.fechaEntrada && r.fechaSalida)
      .sort((a, b) => String(a.fechaEntrada).localeCompare(String(b.fechaEntrada)));
  }, [habSeleccionada, reservasActivas]);

  // Validar si las fechas seleccionadas en el formulario chocan con alguna reserva activa de esa habitación
  const choqueFechasSeleccionadas = useMemo(() => {
    if (!habSeleccionada || !formData.fechaEntrada || !formData.fechaSalida) return false;
    if (formData.fechaSalida <= formData.fechaEntrada) return true;

    // Verificar contra el estado actual de la habitación si está ocupada
    if (habSeleccionada.estado === 'ocupado' && habSeleccionada.fechaEntrada && habSeleccionada.fechaSalida) {
      if (formData.fechaEntrada < habSeleccionada.fechaSalida && formData.fechaSalida > habSeleccionada.fechaEntrada) {
        return true;
      }
    }

    return reservasDeHabSeleccionada.some(r =>
      formData.fechaEntrada < r.fechaSalida && formData.fechaSalida > r.fechaEntrada
    );
  }, [habSeleccionada, formData.fechaEntrada, formData.fechaSalida, reservasDeHabSeleccionada]);

  const nochesCalculadas = useMemo(() => {
    if (!formData.fechaEntrada || !formData.fechaSalida) return 1;
    const inicio = new Date(formData.fechaEntrada).getTime();
    const fin = new Date(formData.fechaSalida).getTime();
    if (Number.isNaN(inicio) || Number.isNaN(fin) || fin <= inicio) return 1;
    return Math.max(1, Math.round((fin - inicio) / (24 * 60 * 60 * 1000)));
  }, [formData.fechaEntrada, formData.fechaSalida]);

  // Autocompletar y verificar siempre la asociación CURP <-> Correo cuando el recepcionista escribe la CURP o el correo
  const handleCurpChange = (valorRaw) => {
    const curpInput = valorRaw.toUpperCase().replace(/\s+/g, '');
    let nuevoForm = { ...formData, curp: curpInput };
    setConflictoCurpCorreo('');

    if (curpInput.length === 18) {
      const usuarioPorCurp = usuariosRegistrados.find(
        u => String(u.curp || '').trim().toUpperCase() === curpInput
      );
      if (usuarioPorCurp) {
        nuevoForm = {
          ...nuevoForm,
          nombre: nuevoForm.nombre || usuarioPorCurp.nombre || '',
          correo: usuarioPorCurp.correo || nuevoForm.correo || '',
          telefono: nuevoForm.telefono || usuarioPorCurp.telefono || ''
        };
      }
    }
    setFormData(nuevoForm);
  };

  const handleCorreoChange = (valorCorreo) => {
    const correoInput = valorCorreo.trim().toLowerCase();
    let nuevoForm = { ...formData, correo: valorCorreo };
    setConflictoCurpCorreo('');

    const usuarioPorCorreo = usuariosRegistrados.find(
      u => String(u.correo || '').trim().toLowerCase() === correoInput
    );
    if (usuarioPorCorreo) {
      nuevoForm = {
        ...nuevoForm,
        nombre: nuevoForm.nombre || usuarioPorCorreo.nombre || '',
        curp: nuevoForm.curp || (usuarioPorCorreo.curp || '').toUpperCase(),
        telefono: nuevoForm.telefono || usuarioPorCorreo.telefono || ''
      };
    }

    // Verificar si la CURP escrita ya pertenece a otro correo distinto o viceversa
    if (nuevoForm.curp.length === 18 && correoInput.length > 3) {
      const dueñoCurp = usuariosRegistrados.find(
        u => String(u.curp || '').trim().toUpperCase() === nuevoForm.curp
      );
      if (dueñoCurp && dueñoCurp.correo && dueñoCurp.correo.trim().toLowerCase() !== correoInput) {
        setConflictoCurpCorreo(`Esta CURP ya está vinculada al correo ${dueñoCurp.correo}.`);
      }
    }

    setFormData(nuevoForm);
  };

  const handleFranquiciaChange = (e) => {
    setFiltroFranquicia(e.target.value);
    setFiltroSucursal('TODAS');
  };

  const cerrarModal = () => {
    const hoyISO = obtenerFechaLocalISO(new Date());
    setHabSeleccionada(null);
    setModo('');
    setHabitacionSecuestrada(false);
    setConflictoCurpCorreo('');
    setFormData({
      nombre: '',
      curp: '',
      correo: '',
      telefono: '',
      fechaEntrada: hoyISO,
      fechaSalida: sumarDiasISO(hoyISO, 1)
    });
  };

  const registrarEnBitacora = async (accion, detalle) => {
    if (!sesionEmpleado) return;
    await addDoc(collection(db, "Bitacora"), {
      tipoAccion: accion,
      nombreEmpleado: sesionEmpleado.nombre || 'Administrador Sistema',
      rolEmpleado: sesionEmpleado.rol || 'N/A',
      detalles: detalle,
      fecha: serverTimestamp()
    });
  };

  const abrirFormularioReservaFechas = (hab) => {
    const hoyISO = obtenerFechaLocalISO(new Date());
    // Si la habitación está ocupada hoy (ej. del 3 al 4 de nov), sugerimos por defecto su fecha de salida (4 de nov) como fecha de entrada
    const entradaSugerida = (hab.estado === 'ocupado' && hab.fechaSalida && hab.fechaSalida >= hoyISO)
      ? hab.fechaSalida
      : hoyISO;
    const salidaSugerida = sumarDiasISO(entradaSugerida, 1);

    setFormData({
      nombre: '',
      curp: '',
      correo: '',
      telefono: '',
      fechaEntrada: entradaSugerida,
      fechaSalida: salidaSugerida
    });
    setConflictoCurpCorreo('');
    setHabitacionSecuestrada(false);
    setHabSeleccionada(hab);
    setModo('checkin');
  };

  const manejarInteraccionTarjeta = (hab) => {
    const rolActual = sesionEmpleado?.rol;
    if (hab.estado === 'disponible') {
      if (rolActual === 'Staff Limpieza') {
        return mostrarNotificacion('Acceso restringido: Solo Recepción o Administración pueden registrar huéspedes.', 'error');
      }
      abrirFormularioReservaFechas(hab);
      return;
    } else if (hab.estado === 'ocupado') {
      if (rolActual === 'Staff Limpieza') {
        return mostrarNotificacion('Acceso restringido: Solo Recepción o Administración pueden realizar Check-out.', 'error');
      }
      setModo('checkout');
    } else if (hab.estado === 'mantenimiento') {
      if (rolActual === 'Recepcionista') {
        // El recepcionista puede abrir una habitación en limpieza para agendar una reserva para las 15:00 hrs o fechas futuras
        abrirFormularioReservaFechas(hab);
        return;
      }
      setModo('limpieza');
    }
    setHabSeleccionada(hab);
    setHabitacionSecuestrada(false);
  };

  const regexCorreo = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const curpValida = formData.curp.length === 0 || validarCurpMatematica(formData.curp.toUpperCase());
  const correoValido = formData.correo.length === 0 || regexCorreo.test(formData.correo.trim());
  const telefonoLleno = formData.telefono.length === 10;

  // Verificar que la CURP y el correo no entren en conflicto con otra cuenta existente
  const conflictoCurpActivo = useMemo(() => {
    if (formData.curp.length !== 18 || !formData.correo.trim()) return '';
    const curpUp = formData.curp.toUpperCase();
    const correoLow = formData.correo.trim().toLowerCase();

    const porCurp = usuariosRegistrados.find(u => String(u.curp || '').trim().toUpperCase() === curpUp);
    if (porCurp && porCurp.correo && porCurp.correo.trim().toLowerCase() !== correoLow) {
      return `La CURP ${curpUp} ya pertenece al correo ${porCurp.correo}. Usa ese correo.`;
    }
    const porCorreo = usuariosRegistrados.find(u => String(u.correo || '').trim().toLowerCase() === correoLow);
    if (porCorreo && porCorreo.curp && porCorreo.curp.trim().toUpperCase() !== curpUp) {
      return `El correo ${correoLow} ya tiene vinculada la CURP ${porCorreo.curp}.`;
    }
    return '';
  }, [formData.curp, formData.correo, usuariosRegistrados]);

  const formCheckinValido =
    formData.nombre.trim().length > 0 &&
    curpValida &&
    formData.curp.length === 18 &&
    correoValido &&
    formData.correo.trim().length > 0 &&
    telefonoLleno &&
    !choqueFechasSeleccionadas &&
    !conflictoCurpActivo;

  const realizarCheckIn = async (e) => {
    e.preventDefault();
    if (!formCheckinValido || habitacionSecuestrada) return;

    const hoyISO = obtenerFechaLocalISO(new Date());
    const fechaEntradaStr = formData.fechaEntrada;
    const fechaSalidaStr = formData.fechaSalida;
    const totalEstancia = Number(habSeleccionada.precioBase || 0) * nochesCalculadas;
    const curpLimpia = formData.curp.trim().toUpperCase();
    const correoLimpio = formData.correo.trim().toLowerCase();
    const nombreLimpio = formData.nombre.trim();

    // Buscar si el huésped ya tiene cuenta en Usuarios (por correo o por CURP) para vincular su uidUsuario de inmediato
    const cuentaExistente = usuariosRegistrados.find(
      u =>
        String(u.curp || '').trim().toUpperCase() === curpLimpia ||
        String(u.correo || '').trim().toLowerCase() === correoLimpio
    );
    const idDocUsuario = cuentaExistente?.id || curpLimpia;
    const uidExistente = cuentaExistente?.uid || '';

    try {
      const habRef = doc(db, "Habitaciones", habSeleccionada.id);

      // Consultar reservas activas frescas de esta habitación para blindar contra overbooking por fechas
      const snapResHab = await getDocs(
        query(
          collection(db, "Reservas"),
          where("idHabitacion", "==", habSeleccionada.id),
          where("estado", "==", "Activa")
        )
      );
      const reservasActualesHab = snapResHab.docs.map(d => d.data());

      await runTransaction(db, async (transaction) => {
        const habDoc = await transaction.get(habRef);
        if (!habDoc.exists()) throw new Error("La habitación no existe.");
        const dataHab = habDoc.data();

        // Validar que no haya traslape de fechas
        const chocaConHab =
          dataHab.estado === 'ocupado' &&
          dataHab.fechaEntrada &&
          dataHab.fechaSalida &&
          fechaEntradaStr < dataHab.fechaSalida &&
          fechaSalidaStr > dataHab.fechaEntrada;

        const chocaConReserva = reservasActualesHab.some(
          r => r.fechaEntrada && r.fechaSalida && fechaEntradaStr < r.fechaSalida && fechaSalidaStr > r.fechaEntrada
        );

        if (chocaConHab || chocaConReserva) {
          throw new Error("HABITACION_OCUPADA");
        }

        // Si la reserva incluye el día de HOY, actualizamos el estado visible de HOY en la habitación
        if (fechaEntradaStr <= hoyISO && fechaSalidaStr > hoyISO) {
          transaction.update(habRef, {
            estado: 'ocupado',
            huespedNombre: nombreLimpio,
            huespedID: curpLimpia,
            fechaEntrada: fechaEntradaStr,
            fechaSalida: fechaSalidaStr,
            totalActual: totalEstancia,
            fechaIngreso: serverTimestamp()
          });
        }

        // Guardar/actualizar en Usuarios manteniendo siempre CURP y Correo vinculados
        const usuarioRef = doc(db, "Usuarios", idDocUsuario);
        transaction.set(usuarioRef, {
          ...(uidExistente ? { uid: uidExistente } : {}),
          nombre: nombreLimpio,
          curp: curpLimpia,
          correo: correoLimpio,
          telefono: formData.telefono,
          ultimaVisita: serverTimestamp(),
          totalEstancias: increment(1)
        }, { merge: true });

        // Crear la reserva vinculando idUsuario (CURP), correoUsuario y uidUsuario (si ya tiene cuenta App)
        const nuevaReservaRef = doc(collection(db, "Reservas"));
        transaction.set(nuevaReservaRef, {
          idSucursal: habSeleccionada.idSucursal,
          idHabitacion: habSeleccionada.id,
          numeroHabitacion: habSeleccionada.numero,
          tipoHabitacion: habSeleccionada.tipo,
          idUsuario: curpLimpia,
          correoUsuario: correoLimpio,
          uidUsuario: uidExistente,
          nombreUsuario: nombreLimpio,
          huespedNombre: nombreLimpio,
          fechaIngreso: serverTimestamp(),
          fechaEntrada: fechaEntradaStr,
          fechaSalida: fechaSalidaStr,
          horaCheckIn: '15:00 hrs',
          horaCheckOut: '12:00 hrs',
          estado: 'Activa',
          metodoPago: 'Recepción Directa',
          totalGenerado: totalEstancia
        });

        const nuevaBitacoraRef = doc(collection(db, "Bitacora"));
        transaction.set(nuevaBitacoraRef, {
          tipoAccion: 'OPERACIÓN',
          nombreEmpleado: sesionEmpleado.nombre || 'Admin',
          rolEmpleado: sesionEmpleado.rol || 'Sistema',
          detalles: `Reserva/Check-in Recepción: ${nombreLimpio} (CURP: ${curpLimpia} | Correo: ${correoLimpio}) en Hab. #${habSeleccionada.numero} del ${fechaEntradaStr} al ${fechaSalidaStr}`,
          fecha: serverTimestamp()
        });
      });

      mostrarNotificacion(
        fechaEntradaStr <= hoyISO
          ? `Check-in registrado en Habitación #${habSeleccionada.numero}`
          : `Reserva agendada en Habitación #${habSeleccionada.numero} (${fechaEntradaStr} al ${fechaSalidaStr})`
      );
      cerrarModal();
    } catch (error) {
      console.error(error);
      if (error.message === "HABITACION_OCUPADA") {
        setHabitacionSecuestrada(true);
      } else {
        mostrarNotificacion("Error inesperado al procesar la reserva.", "error");
      }
    }
  };

  const realizarCheckOut = async () => {
    const hoyISO = obtenerFechaLocalISO(new Date());
    const horaActual = new Date().getHours();
    // Si se hace check-out antes de las 15:00 hrs, pasa a limpieza (mantenimiento) hasta las 15:00 hrs; si ya son >= 15:00 hrs, puede pasar a limpieza o liberarse
    try {
      await updateDoc(doc(db, "Habitaciones", habSeleccionada.id), {
        estado: horaActual < 15 ? 'mantenimiento' : 'mantenimiento',
        fechaMantenimientoISO: hoyISO,
        fechaSalidaReal: serverTimestamp()
      });
      const q = query(collection(db, "Reservas"), where("idHabitacion", "==", habSeleccionada.id), where("estado", "==", "Activa"));

      const snapshotDocs = await getDocs(q);
      await Promise.all(
        snapshotDocs.docs
          .filter(d => !d.data().fechaEntrada || d.data().fechaEntrada <= hoyISO)
          .map((d) =>
            updateDoc(doc(db, "Reservas", d.id), {
              estado: 'Completada',
              fechaSalidaReal: serverTimestamp()
            })
          )
      );

      await registrarEnBitacora('MODIFICACIÓN', `Check-out: Habitación #${habSeleccionada.numero} enviada a limpieza (se libera automáticamente a las 15:00 hrs o al confirmar limpieza).`);
      mostrarNotificacion(`Salida registrada. Habitación #${habSeleccionada.numero} en protocolo de limpieza.`);
      cerrarModal();
    } catch (error) {
      console.error(error);
      mostrarNotificacion("Error al registrar salida.", "error");
    }
  };

  const cancelarReservaActiva = async () => {
    const hoyISO = obtenerFechaLocalISO(new Date());
    try {
      await updateDoc(doc(db, "Habitaciones", habSeleccionada.id), {
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

      const q = query(collection(db, "Reservas"), where("idHabitacion", "==", habSeleccionada.id), where("estado", "==", "Activa"));
      const snapshotDocs = await getDocs(q);
      await Promise.all(
        snapshotDocs.docs
          .filter(d => !d.data().fechaEntrada || d.data().fechaEntrada <= hoyISO)
          .map((d) =>
            updateDoc(doc(db, "Reservas", d.id), {
              estado: 'Cancelada',
              fechaCancelacion: serverTimestamp()
            })
          )
      );

      await registrarEnBitacora('ELIMINACIÓN', `Reserva cancelada: Habitación #${habSeleccionada.numero} liberada inmediatamente.`);
      mostrarNotificacion(`Reserva cancelada. Habitación #${habSeleccionada.numero} nuevamente disponible.`);
      cerrarModal();
    } catch (error) {
      console.error(error);
      mostrarNotificacion("Error al cancelar la reserva.", "error");
    }
  };

  const finalizarLimpieza = async () => {
    try {
      await updateDoc(doc(db, "Habitaciones", habSeleccionada.id), {
        estado: 'disponible',
        huespedNombre: null,
        huespedID: null,
        fechaEntrada: null,
        fechaSalida: null,
        totalActual: null,
        serviciosActuales: [],
        fechaIngreso: null,
        fechaSalidaReal: null,
        fechaMantenimientoISO: null
      });
      await registrarEnBitacora('OPERACIÓN', `Limpieza terminada: Habitación #${habSeleccionada.numero} lista para Check-in (15:00 hrs).`);
      mostrarNotificacion(`Habitación #${habSeleccionada.numero} habilitada como Disponible.`);
      cerrarModal();
    } catch (error) {
      console.error(error);
      mostrarNotificacion("Error al liberar habitación.", "error");
    }
  };

  const formatearEstancia = (hab) => {
    if (hab.fechaEntrada && hab.fechaSalida) {
      return `${hab.fechaEntrada} (15:00h) → ${hab.fechaSalida} (12:00h)`;
    }
    if (!hab.fechaIngreso) return "Check-out 12:00 hrs";
    const fecha = typeof hab.fechaIngreso.toDate === 'function' ? hab.fechaIngreso.toDate() : new Date(hab.fechaIngreso);
    return `Ingreso: ${fecha.toLocaleDateString('es-MX')} · Salida 12:00h`;
  };

  const estilosTarjeta = (estado) => {
    switch (estado) {
      case 'disponible':
        return {
          bg: '#ffffff',
          topBar: '#dcfce7',
          border: '#86efac',
          badgeBg: '#16a34a',
          txtF: '#0f172a',
          txtS: '#15803d',
          label: 'DISPONIBLE HOY'
        };
      case 'ocupado':
        return {
          bg: '#fff5f5',
          topBar: '#fee2e2',
          border: '#fca5a5',
          badgeBg: '#dc2626',
          txtF: '#7f1d1d',
          txtS: '#b91c1c',
          label: 'OCUPADA HOY'
        };
      default:
        return {
          bg: '#fffdf0',
          topBar: '#fef9c3',
          border: '#fde047',
          badgeBg: '#d97706',
          txtF: '#713f12',
          txtS: '#b45309',
          label: 'LIMPIEZA (12:00-15:00)'
        };
    }
  };

  const hoyISO = obtenerFechaLocalISO(relojActual);

  return (
    <div className="habitaciones-page" style={{ position: 'relative' }}>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ color: '#0f172a', margin: '0 0 5px 0', fontSize: '24px', fontWeight: '800' }}>Panel Operativo de Habitaciones</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
            <span style={{ background: '#0f172a', color: '#38bdf8', padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={14} /> Reloj sincronizado: {relojActual.toLocaleDateString('es-MX')} · {relojActual.toLocaleTimeString('es-MX')}
            </span>
            <span style={{ color: '#64748b', fontSize: '13px', fontWeight: '600' }}>
              Check-out 12:00 hrs → Limpieza 12:00 a 15:00 hrs → Libre / Check-in 15:00 hrs
            </span>
          </div>
        </div>
        {esAdmin && (
          <div style={{ background: 'white', padding: '14px 22px', borderRadius: '14px', boxShadow: '0 4px 15px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '20px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' }}>
              <label style={{ fontWeight: '700', fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px', textTransform: 'uppercase' }}>
                <Building size={13} color="#0284c7" /> Franquicia
              </label>
              <select value={filtroFranquicia} onChange={handleFranquiciaChange} style={{ color: '#0f172a', border: '1px solid #cbd5e1', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', outline: 'none', fontWeight: '600', cursor: 'pointer', fontSize: '13px', minWidth: '160px' }}>
                <option value="TODAS">Todas</option>
                {listaFranquicias.map(f => <option key={f.id} value={f.id}>{f.nombreCorporativo}</option>)}
              </select>
            </div>
            <div style={{ borderLeft: '1px solid #e2e8f0', height: '38px' }}></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' }}>
              <label style={{ fontWeight: '700', fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px', textTransform: 'uppercase' }}>
                <MapPin size={13} color="#16a34a" /> Hotel
              </label>
              <select value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)} style={{ color: '#0f172a', border: '1px solid #cbd5e1', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', outline: 'none', fontWeight: '600', cursor: 'pointer', fontSize: '13px', minWidth: '180px' }}>
                <option value="TODAS">Todos los Hoteles</option>
                {sucursalesFiltradas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* GRID DE TARJETAS REDISEÑADAS Y MODERNAS */}
      <div className="room-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '20px' }}>
        {habitacionesVisuales.map(hab => {
          const st = estilosTarjeta(hab.estado);
          const nombreHotel = mapaSucursales[hab.idSucursal] || 'Hotel Registrado';
          const amenidades = Array.isArray(hab.servicios) ? hab.servicios.slice(0, 3) : [];
          const reservasFuturasHab = reservasActivas
            .filter(r => r.idHabitacion === hab.id && r.fechaEntrada && r.fechaEntrada > hoyISO)
            .sort((a, b) => String(a.fechaEntrada).localeCompare(String(b.fechaEntrada)));

          return (
            <div
              key={hab.id}
              onClick={() => manejarInteraccionTarjeta(hab)}
              style={{
                borderRadius: '16px',
                cursor: 'pointer',
                background: st.bg,
                border: `2px solid ${st.border}`,
                boxShadow: '0 6px 18px rgba(15, 23, 42, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                overflow: 'hidden',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease'
              }}
            >
              {/* ENCABEZADO DE LA TARJETA CON NOMBRE DEL HOTEL */}
              <div style={{
                background: st.topBar,
                padding: '10px 16px',
                borderBottom: `1px solid ${st.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: '800',
                  color: '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  <MapPin size={13} color="#0284c7" style={{ flexShrink: 0 }} />
                  {nombreHotel}
                </span>
                <span style={{
                  fontSize: '10px',
                  fontWeight: '800',
                  color: 'white',
                  background: st.badgeBg,
                  padding: '3px 8px',
                  borderRadius: '999px',
                  letterSpacing: '0.4px',
                  flexShrink: 0
                }}>
                  {st.label}
                </span>
              </div>

              {/* CUERPO PRINCIPAL DE LA TARJETA */}
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: '900', fontSize: '26px', color: '#0f172a' }}>Hab. #{hab.numero}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
                      <BedDouble size={14} color="#0284c7" />
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#0284c7' }}>
                        Categoría: {hab.tipo || 'Tradicional'}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '16px', fontWeight: '900', color: '#0f172a' }}>
                      ${Number(hab.precioBase || 0).toLocaleString()}
                    </span>
                    <span style={{ display: 'block', fontSize: '11px', color: '#64748b', fontWeight: '600' }}>MXN / noche</span>
                  </div>
                </div>

                {hab.estado === 'ocupado' ? (
                  <div style={{
                    background: 'white',
                    padding: '12px',
                    borderRadius: '12px',
                    border: '1px solid #fecaca',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: '800', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={15} color="#dc2626" style={{ flexShrink: 0 }} />
                      <span>Ocupado por: <strong style={{ color: '#0f172a' }}>{hab.huespedNombre || 'Huésped Registrado'}</strong></span>
                    </p>
                    {hab.huespedID && (
                      <p style={{ margin: 0, fontSize: '11px', color: '#64748b', fontFamily: 'monospace', fontWeight: '700' }}>
                        CURP: {hab.huespedID}
                      </p>
                    )}
                    <p style={{ margin: 0, fontSize: '11px', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: '700' }}>
                      <Calendar size={13} style={{ flexShrink: 0 }} /> {formatearEstancia(hab)}
                    </p>
                    <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>
                      ✓ Disponible para apartar a partir del {hab.fechaSalida || 'Check-out'}
                    </p>
                  </div>
                ) : hab.estado === 'disponible' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {amenidades.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {amenidades.map((am, idx) => (
                          <span key={idx} style={{ fontSize: '11px', background: '#f1f5f9', color: '#475569', padding: '3px 8px', borderRadius: '6px', fontWeight: '600' }}>
                            {am}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontSize: '12px', fontWeight: '700', marginTop: '2px' }}>
                      <CheckCircle2 size={15} /> Disponible hoy y para calendario futuro
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: 'white',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #fde047',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    color: '#a16207',
                    fontSize: '12px',
                    fontWeight: '700'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Eraser size={16} /> En limpieza (se libera automático a las 15:00 hrs)
                    </div>
                    <span style={{ fontSize: '11px', color: '#0284c7' }}>
                      ✓ Se puede seguir apartando para hoy 15:00h u otros días
                    </span>
                  </div>
                )}

                {reservasFuturasHab.length > 0 && (
                  <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', color: '#0369a1', fontWeight: '700' }}>
                    📅 Próxima reserva: {reservasFuturasHab[0].fechaEntrada} → {reservasFuturasHab[0].fechaSalida} ({reservasFuturasHab[0].nombreUsuario || 'Huésped'})
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {habSeleccionada && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(15, 23, 42, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: 'white', padding: '28px', borderRadius: '16px', width: '92%', maxWidth: '500px', position: 'relative', maxHeight: '92vh', overflowY: 'auto' }}>
            <button onClick={cerrarModal} style={{ position: 'absolute', top: '18px', right: '18px', background: '#f1f5f9', border: 'none', cursor: 'pointer', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} />
            </button>

            {habitacionSecuestrada && (
              <div style={{ background: '#fef2f2', border: '2px solid #ef4444', padding: '20px', borderRadius: '12px', marginBottom: '10px', textAlign: 'center' }}>
                <AlertTriangle size={36} color="#ef4444" style={{ marginBottom: '10px' }} />
                <h4 style={{ margin: '0 0 8px 0', color: '#991b1b', fontSize: '18px' }}>¡Fechas Interceptadas!</h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#b91c1c', lineHeight: '1.5' }}>
                  El motor distribuido detectó que otro canal acaba de reservar esta habitación en esas mismas fechas.
                </p>
                <button type="button" onClick={cerrarModal} style={{ marginTop: '16px', width: '100%', padding: '12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  Regresar al Panel
                </button>
              </div>
            )}

            {!habitacionSecuestrada && modo === 'checkin' && (
              <form onSubmit={realizarCheckIn}>
                <h3 style={{ marginTop: 0, marginBottom: '4px', color: '#0f172a' }}>
                  Check-in / Reserva por Fechas: Hab. #{habSeleccionada.numero}
                </h3>
                <p style={{ marginTop: 0, marginBottom: '14px', fontSize: '13px', color: '#0284c7', fontWeight: '700' }}>
                  {mapaSucursales[habSeleccionada.idSucursal] || 'Hotel'} · {habSeleccionada.tipo} (${Number(habSeleccionada.precioBase || 0).toLocaleString()} MXN/noche)
                </p>

                {reservasDeHabSeleccionada.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '10px 12px', borderRadius: '10px', marginBottom: '14px', fontSize: '12px', color: '#92400e' }}>
                    <strong>Fechas ya reservadas en Hab. #{habSeleccionada.numero}:</strong>
                    {reservasDeHabSeleccionada.map(r => (
                      <div key={r.id} style={{ marginTop: '3px' }}>
                        • Del <strong>{r.fechaEntrada}</strong> (15:00h) al <strong>{r.fechaSalida}</strong> (12:00h) — {r.nombreUsuario || r.huespedNombre}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
                      Llegada (Check-in 15:00h)
                    </label>
                    <input
                      type="date"
                      required
                      min={hoyISO}
                      value={formData.fechaEntrada}
                      onChange={(e) => {
                        const nuevaEntrada = e.target.value;
                        const nuevaSalida = formData.fechaSalida <= nuevaEntrada ? sumarDiasISO(nuevaEntrada, 1) : formData.fechaSalida;
                        setFormData({ ...formData, fechaEntrada: nuevaEntrada, fechaSalida: nuevaSalida });
                      }}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
                      Salida (Check-out 12:00h)
                    </label>
                    <input
                      type="date"
                      required
                      min={sumarDiasISO(formData.fechaEntrada || hoyISO, 1)}
                      value={formData.fechaSalida}
                      onChange={(e) => setFormData({ ...formData, fechaSalida: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {choqueFechasSeleccionadas && (
                  <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', marginBottom: '12px', border: '1px solid #fecaca' }}>
                    ✗ Esas fechas se traslapan con otra estancia en esta habitación. Selecciona días posteriores al Check-out (12:00h).
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>CURP (18 caracteres)</label>
                    <input
                      type="text"
                      required
                      maxLength={18}
                      placeholder="XXXX000000HXXXXX00"
                      value={formData.curp}
                      onChange={(e) => handleCurpChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: formData.curp.length > 0 ? (curpValida && formData.curp.length === 18 ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1',
                        boxSizing: 'border-box',
                        textTransform: 'uppercase'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>Correo Vinculado a CURP</label>
                    <input
                      type="email"
                      required
                      placeholder="huesped@correo.com"
                      value={formData.correo}
                      onChange={(e) => handleCorreoChange(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: formData.correo.length > 0 ? (correoValido && !conflictoCurpActivo ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                {(conflictoCurpActivo || conflictoCurpCorreo) && (
                  <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '700', marginBottom: '12px', border: '1px solid #fecaca' }}>
                    ⚠ {conflictoCurpActivo || conflictoCurpCorreo}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>Nombre Completo del Huésped</label>
                    <input
                      type="text"
                      required
                      value={formData.nombre}
                      onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>Teléfono (10 dígitos)</label>
                    <input
                      type="tel"
                      required
                      placeholder="10 dígitos"
                      maxLength="10"
                      value={formData.telefono}
                      onChange={(e) => setFormData({ ...formData, telefono: e.target.value.replace(/[^0-9]/g, '') })}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        border: formData.telefono.length > 0 ? (telefonoLleno ? '2px solid #22c55e' : '2px solid #ef4444') : '1px solid #cbd5e1',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '13px', color: '#475569', fontWeight: '600' }}>
                    Total estancia ({nochesCalculadas} {nochesCalculadas === 1 ? 'noche' : 'noches'}):
                  </span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: '#16a34a' }}>
                    ${(Number(habSeleccionada.precioBase || 0) * nochesCalculadas).toLocaleString()} MXN
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="submit" disabled={!formCheckinValido} style={{ flex: 1, padding: '13px', background: formCheckinValido ? '#0284c7' : '#cbd5e1', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: formCheckinValido ? 'pointer' : 'not-allowed' }}>
                    Confirmar Reserva
                  </button>
                  <button type="button" onClick={cerrarModal} style={{ flex: 1, padding: '13px', background: 'white', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {!habitacionSecuestrada && modo === 'checkout' && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: '18px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Receipt size={22} color="#0284c7" /> Gestión de Estancia / Check-out
                </h3>
                <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #e2e8f0', display: 'grid', gap: '10px' }}>
                  <p style={{ margin: 0, color: '#0284c7', fontSize: '13px', fontWeight: '800' }}>{mapaSucursales[habSeleccionada.idSucursal] || 'Hotel'}</p>
                  <p style={{ margin: 0, color: '#334155', fontSize: '14px' }}><strong>Habitación:</strong> #{habSeleccionada.numero} ({habSeleccionada.tipo})</p>
                  <p style={{ margin: 0, color: '#334155', fontSize: '14px' }}><strong>Ocupado por:</strong> {habSeleccionada.huespedNombre || 'Huésped Registrado'}</p>
                  {habSeleccionada.huespedID && (
                    <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}><strong>CURP:</strong> {habSeleccionada.huespedID}</p>
                  )}
                  {habSeleccionada.fechaEntrada && habSeleccionada.fechaSalida && (
                    <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>
                      <strong>Periodo actual:</strong> {habSeleccionada.fechaEntrada} (15:00h) al {habSeleccionada.fechaSalida} (12:00h)
                    </p>
                  )}
                  <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '14px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>Total de Estancia:</strong>
                    <span style={{ color: '#16a34a', fontSize: '22px', fontWeight: '900' }}>
                      ${Number(habSeleccionada.totalActual || habSeleccionada.precioBase || 0).toLocaleString()} MXN
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    onClick={() => abrirFormularioReservaFechas(habSeleccionada)}
                    style={{ width: '100%', padding: '13px', background: '#f0f9ff', color: '#0284c7', border: '1px solid #7dd3fc', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    <CalendarPlus size={18} /> Agendar Reserva para Otras Fechas (Ej. del {habSeleccionada.fechaSalida || 'Check-out'} en adelante)
                  </button>
                  <button onClick={realizarCheckOut} style={{ width: '100%', padding: '14px', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <LogOut size={18} /> Finalizar Estancia Hoy (Enviar a Limpieza)
                  </button>
                  <button onClick={cancelarReservaActiva} style={{ width: '100%', padding: '12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Ban size={16} /> Cancelar Reserva Activa (Liberar Ya)
                  </button>
                </div>
              </div>
            )}

            {!habitacionSecuestrada && modo === 'limpieza' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ background: '#fefce8', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
                  <Eraser size={30} color="#ca8a04" />
                </div>
                <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#0f172a' }}>Control de Limpieza (12:00h - 15:00h)</h3>
                <p style={{ color: '#475569', marginBottom: '20px', fontSize: '14px' }}>
                  La habitación <strong>#{habSeleccionada.numero}</strong> ({mapaSucursales[habSeleccionada.idSucursal]}) se encuentra en limpieza tras el Check-out y pasará automáticamente a disponible a las <strong>15:00 hrs</strong>, o puedes habilitarla ahora mismo:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button onClick={finalizarLimpieza} style={{ width: '100%', padding: '14px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <CheckCircle2 size={18} /> Marcar Disponible Ahora
                  </button>
                  {sesionEmpleado?.rol !== 'Staff Limpieza' && (
                    <button onClick={() => abrirFormularioReservaFechas(habSeleccionada)} style={{ width: '100%', padding: '12px', background: '#f0f9ff', color: '#0284c7', border: '1px solid #7dd3fc', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      <CalendarPlus size={17} /> Agendar Reserva para 15:00 hrs u Otras Fechas
                    </button>
                  )}
                  <button onClick={cerrarModal} style={{ width: '100%', padding: '12px', background: 'white', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                    Cerrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Habitaciones;
