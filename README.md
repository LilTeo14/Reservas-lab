# ReservaLab USM 🔧

Plataforma de reservas para la **Cortadora Láser** y la **Máquina CNC** del laboratorio de fabricación digital.

---

## 🚀 Configurar Vercel KV (base de datos gratuita)

> **Este paso es necesario una sola vez para que las reservas se guarden en la nube.**

### 1. Deploy en Vercel

Conecta el repositorio `LilTeo14/Reservas-lab` a Vercel si aún no lo has hecho:

```
vercel.com → Add New → Project → Import Git Repository → LilTeo14/Reservas-lab
```

### 2. Crear la base de datos KV

Desde el **dashboard de tu proyecto en Vercel**:

1. Ir a la pestaña **Storage**
2. Clic en **Create Database**
3. Seleccionar **KV** (Upstash Redis)
4. Nombre: `reservalab-kv` (o el que prefieras)
5. Región: `Washington D.C., USA (East)` (o la más cercana)
6. Clic en **Create & Connect**

> ✅ Vercel añade automáticamente las variables de entorno al proyecto.  
> No necesitas copiar ningún token manualmente.

### 3. Hacer redeploy

Después de conectar el KV, haz un nuevo deploy (o simplemente haz un push a GitHub):

```bash
git commit --allow-empty -m "conectar vercel kv"
git push
```

Vercel desplegará automáticamente con la base de datos lista.

---

## 💻 Desarrollo local

Para probar la app localmente **con la misma base de datos de producción**:

```bash
# 1. Instalar Vercel CLI
npm install -g vercel

# 2. Autenticarse
vercel login

# 3. Vincular el proyecto
vercel link

# 4. Descargar variables de entorno (incluye credenciales KV)
vercel env pull .env.local

# 5. Instalar dependencias
npm install

# 6. Iniciar servidor local con API
vercel dev
```

La app estará disponible en `http://localhost:3000`.

> **Sin `vercel dev`:** Si abres `index.html` directamente en el navegador, la API no estará disponible y la app usará automáticamente `localStorage` como fallback (los datos son locales y no se comparten entre usuarios).

---

## 📁 Estructura del proyecto

```
reservas-lab/
├── api/
│   └── reservations.js   # Serverless function (backend)
├── index.html            # Interfaz principal
├── styles.css            # Estilos (dark mode premium)
├── app.js                # Lógica frontend (async API calls)
├── package.json          # Dependencia @vercel/kv
└── README.md
```

## 🔌 API

| Método   | Endpoint              | Descripción                         |
|----------|-----------------------|-------------------------------------|
| `GET`    | `/api/reservations`   | Devuelve todas las reservas         |
| `POST`   | `/api/reservations`   | Guarda nuevas reservas para un email|
| `DELETE` | `/api/reservations`   | Cancela una reserva específica      |

---

## ✨ Funcionalidades

- Reserva de **Cortadora Láser** o **Máquina CNC**
- Validación de correo `@usm.cl` y cualquier subdominio (`@sansano.usm.cl`, etc.)
- Máximo **3 bloques por persona por semana** por máquina
- Selector de **esta semana / próxima semana**
- Muestra el **ayudante** asignado a cada bloque
- Bloques sin ayudante están **deshabilitados automáticamente**
- Slots ocupados visibles para todos los usuarios en tiempo real
- **Datos persistentes en Vercel KV** (compartidos entre todos los usuarios)
- Fallback a `localStorage` para desarrollo local sin `vercel dev`

---

## 🗓️ Horario de ayudantes

| Bloque     | Horario       | Lunes          | Martes          | Miércoles       | Jueves         | Viernes       |
|------------|---------------|----------------|-----------------|-----------------|----------------|---------------|
| Bloque 5-6 | 11:05 – 12:15 | Renato Rivera  | Ignacio Trujillo| Ignacio Trujillo| Bastian Pizarro| Mateo Morales |
| Bloque 7-8 | 12:30 – 13:40 | Bastian Pizarro| —               | Matías Zamora   | —              | Matías Zamora |
| Bloque 9-10| 14:40 – 15:50 | Juan Espinoza  | María Urtecho   | Paula Aravena   | Mateo Morales  | Hans Toledo   |
| Bloque 11-12| 16:05 – 17:15| Juan Espinoza  | María Urtecho   | Paula Aravena   | Hans Toledo    | Renato Rivera |

> Los bloques marcados con — no tienen ayudante y **no se pueden reservar**.
