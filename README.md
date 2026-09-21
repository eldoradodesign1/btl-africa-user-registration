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

## Création de compte et approbation

L’écran de connexion propose désormais deux options : **Se connecter** et **Créer un compte**. Le signup crée exclusivement une demande d’accès de rôle `agent` dans `public.user_registration_requests`; il ne crée jamais directement une ligne dans `public.users`. La demande reste `pending` jusqu’à l’action d’un `super_admin`, puis l’approbation crée l’agent dans `public.users`. Les agents pending ne sont donc pas renvoyés par la liste principale et ne peuvent pas apparaître dans les listes opérationnelles avant validation.

La migration à exécuter dans le projet Supabase est [`supabase/migrations/202609210001_registration_requests.sql`](supabase/migrations/202609210001_registration_requests.sql). Elle crée la table, son index anti-doublon sur les demandes pending et quatre fonctions RPC `SECURITY DEFINER` : création de demande publique, lecture super_admin, approbation et rejet. Le projet utilise une authentification métier basée sur `public.users.password_hash` et non Supabase Auth; les RPC reviewer valident donc explicitement l’UUID et le rôle `super_admin` avant toute lecture ou mutation.

Les campagnes existantes sont lues depuis `public.campaigns` et les affectations actives depuis `public.user_campaign_assignments`. La migration [`supabase/migrations/202609210002_campaign_assignments_rpc.sql`](supabase/migrations/202609210002_campaign_assignments_rpc.sql) ajoute la RPC `set_user_campaign_assignments`, réservée aux rôles `admin`, `super_admin` et `supervisor`. Elle permet plusieurs campagnes par agent, désactive les anciennes affectations retirées et vérifie la compatibilité entre une campagne hôtesse ou Brand Ambassador et la catégorie de l’agent.

Les vues par rôle utilisent les données métier existantes : `daily_reports` pour les hôtesses et `ba_daily_attendance` via `campaign_runs` pour les Brand Ambassadors. La migration [`supabase/migrations/202609210003_campaign_assignment_requests.sql`](supabase/migrations/202609210003_campaign_assignment_requests.sql) crée les demandes d’affectation des agents ainsi que les RPC de consultation et de validation par les managers. La migration [`supabase/migrations/202609210004_user_profile_updates.sql`](supabase/migrations/202609210004_user_profile_updates.sql) active la modification sécurisée du nom, du MSISDN, du mot de passe et de la photo de profil.

Après connexion, un agent voit ses responsables, ses campagnes et un suivi combinant courbe de performance et registre de présence. Un superviseur voit ses responsables, ses agents et peut ouvrir la fiche d’un agent, sélectionner une campagne, approuver une demande et exporter le suivi au format XLS ou via impression PDF. Dans la console admin, le clic sur un agent ouvre cette même fiche; l’édition reste accessible par l’action crayon.

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

## Identifiants utilisateurs

Dans le projet Supabase cible, le champ `public.users.id` est de type **text**. Les demandes d’inscription utilisent un UUID interne, converti explicitement en texte uniquement au moment de l’approbation afin de rester compatible avec le schéma existant. Aucun identifiant réel n’est hardcodé dans l’application métier et le code ne suppose jamais que les identifiants sont séquentiels.

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

Toutes les occurrences de téléphone rendues dans l’interface utilisent maintenant le bouton `CopyablePhone`; un clic copie le numéro brut dans le presse-papier, avec un fallback compatible lorsque l’API Clipboard n’est pas disponible. Les modales du dashboard sont rendues dans `document.body` via un portal, avec une hauteur indépendante du contenu de la page et un scroll interne uniquement lorsque nécessaire.
