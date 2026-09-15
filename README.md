# BTL Africa — Création d’utilisateurs

Interface React/Vite mobile-first pour enregistrer un nouvel utilisateur ou agent dans la table existante `public.users` de BTL Africa Privilege Tracker.

## Ce qui est inclus

L’interface propose une validation MSISDN en temps réel, un contrôle anti-doublon à trois niveaux, une liste de superviseurs filtrée par rôle, les catégories de campagne distinctes, la règle « Aucun shop » vers `null`, un état de chargement non bloquant, les toasts de succès/erreur, un récapitulatif non sensible après création, un tableau de bord administrateur sécurisé et un mode démo explicite lorsque Supabase n’est pas configuré.

Le code est organisé dans le template WebDev React :

| Cahier des charges | Fichier du projet |
| --- | --- |
| `index.html` | `client/index.html` |
| `styles.css` | `client/src/index.css` — thème global de l’interface |
| `app.js` | `client/src/App.tsx` + `client/src/pages/Home.tsx` |
| Module téléphone | `client/src/lib/phone.ts` |
| Module Supabase | `client/src/lib/supabase.ts` |
| Dashboard | `client/src/pages/AdminDashboard.tsx` |
| Règles du formulaire | `client/src/lib/user-form.ts` |
| Tests | `client/src/lib/phone.test.ts` et `client/src/lib/supabase.test.ts` |

## Branchement Supabase

Pour une configuration au démarrage, créez un fichier `.env.local` à la racine du projet et renseignez :

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
```

`VITE_SUPABASE_ANON_KEY` est également accepté pour les projets qui utilisent encore l’ancien nom de variable. Redémarrez ensuite le serveur Vite.

Vous pouvez aussi renseigner les valeurs directement dans **Dashboard → Configurer**. Cette configuration runtime est conservée uniquement dans `sessionStorage` pour l’onglet courant ; la clé est effacée quand le projet est déconnecté. La clé Supabase est toujours saisie dans un champ masqué et les clés contenant `service_role` sont refusées.

Après configuration, le dashboard demande une connexion **par MSISDN et mot de passe existant** avant de lire `public.users`. Le numéro local `0812345678` est essayé avec son équivalent international `+243812345678`, puis la ligne est vérifiée avec la valeur déjà utilisée dans `password_hash`. Aucun nouveau mécanisme d’authentification n’est introduit. Le profil correspondant détermine le rôle. L’écran n’affiche pas les données fictives dans ce parcours réel.

Le rôle `super_admin` est le seul autorisé à ouvrir le formulaire **Nouvel utilisateur**. Les rôles `agent`, `supervisor`, `sub_admin` et `admin` peuvent se connecter au dashboard, rechercher, filtrer, actualiser et exporter les données, mais restent en **lecture seule**. Les politiques RLS du projet doivent autoriser l’utilisateur authentifié à sélectionner les colonnes nécessaires et doivent réserver l’insertion à la logique d’administration autorisée.

**Ne renseignez jamais une clé `service_role` dans une variable `VITE_*` ou dans le frontend.** Si une opération d’administration exige des privilèges élevés, utilisez une RPC ou une Edge Function Supabase sécurisée, puis appelez-la depuis le frontend avec la clé publishable/anon et des politiques RLS adaptées.

Sans ces variables, le formulaire affiche **Mode démo actif** avec un petit jeu de données en mémoire pour tester l’interface. Le dashboard, lui, masque ces données et demande d’abord une configuration Supabase réelle. Aucun mot de passe n’est stocké dans `localStorage` ou l’URL ; la connexion reste en mémoire jusqu’à la fermeture ou la déconnexion.

## Dashboard et historique MSISDN

Le dashboard permet de rechercher rapidement un nom ou un MSISDN — le format `+24381…` est normalisé avant la comparaison — puis de filtrer par rôle et catégorie. Le bouton **Actualiser** relit `public.users` sans recharger la page. L’export CSV utilise uniquement les lignes filtrées et les colonnes non sensibles (`id`, identité, téléphone, rôle, catégorie, superviseur et shop) ; `password_hash` n’est jamais sélectionné ni exporté.

## Schéma cible et payload

La cible est exclusivement la table existante `public.users`. L’application ne crée ni ne modifie aucune autre table.

Exemple de payload strict, limité aux colonnes autorisées :

```json
{
  "id": "6a3ecb0e-f3b2-4fd8-9f12-bb9dc2b2fa8d",
  "full_name": "Grâce Mbuyi",
  "phone": "0812345678",
  "password_hash": "<valeur conforme au mécanisme d’authentification existant>",
  "role": "agent",
  "user_category": "hostess",
  "supervisor_id": "b7d7aef4-2e2b-4a7e-9f12-1d5ce8481b0a",
  "permanent_shop_id": null
}
```

L’interface normalise toujours le téléphone au format local `0XXXXXXXXX` avant la recherche et l’insertion. « Aucun shop » est transformé en `null`, jamais enregistré comme une chaîne.

## UUID utilisateurs

Le champ `public.users.id` est un **UUID PostgreSQL**, pas un nombre et pas un identifiant séquentiel. Le frontend utilise `crypto.randomUUID()` uniquement lorsque l’architecture client-insert est autorisée. Une RPC ou une Edge Function peut être préférée afin de laisser PostgreSQL générer l’identifiant avec `gen_random_uuid()`. Aucun UUID réel n’est hardcodé dans l’application métier et le code ne suppose jamais que les UUID sont séquentiels.

## Contrôle anti-doublon

1. **Validation locale** : nettoyage des espaces, tirets, points, parenthèses et `+`, validation du préfixe `08`/`09` et du nombre de chiffres.
2. **Lookup Supabase debounced** : recherche ciblée `.eq('phone', normalizedPhone)` après 420 ms, avec invalidation des requêtes obsolètes.
3. **Contrainte unique PostgreSQL** : une erreur `23505` ou une erreur mentionnant `phone` est convertie en message anti-doublon professionnel.

Les rôles proposés sont strictement `agent`, `supervisor`, `sub_admin`, `admin` et `super_admin`. Les catégories sont strictement `hostess`, `brand_ambassador`, `brand_ambassador_youth` et `operations`.

## Développement et tests

```bash
pnpm install
pnpm dev
pnpm check
pnpm exec vitest run client/src/lib/phone.test.ts client/src/lib/supabase.test.ts
pnpm build
```

Le bouton **Créer l’utilisateur** est désactivé tant que le nom, le MSISDN ou le contrôle anti-doublon n’est pas valide. L’accès au formulaire est en plus réservé au profil `super_admin`. Le formulaire reste utilisable au clavier et sur mobile.
