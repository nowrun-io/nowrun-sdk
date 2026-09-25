package gg.now.bridge;

import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import static gg.now.bridge.JavaTypes.SUBTYPE_KEY;
import static gg.now.bridge.JavaTypes.componentTypeOf;
import static gg.now.bridge.JavaTypes.dataFieldsOf;
import static gg.now.bridge.JavaTypes.describeSubtypes;
import static gg.now.bridge.JavaTypes.isBoxedForm;
import static gg.now.bridge.JavaTypes.isCreatable;
import static gg.now.bridge.JavaTypes.isDataField;
import static gg.now.bridge.JavaTypes.knownSubtypesOf;
import static gg.now.bridge.JavaTypes.rawClassOf;
import static gg.now.bridge.JavaTypes.resolved;
import static gg.now.bridge.JavaTypes.typeArgument;

/**
 * Reads a call's arguments as the types its function declares. The client keys them "arg0",
 * "arg1", ... and sends each as text - a string as it is, anything else as its JSON, a null
 * as "null" - so everything other than a string is read back out of that text.
 *
 * A value that does not suit its type throws IllegalArgumentException, whose message names
 * the argument - "arg0.row expects a valid int" - so it can go back to the caller as it is.
 */
final class ArgumentReader {

    private ArgumentReader() {
    }

    // ---- Reflected functions ----------------------------------------------------------------

    /** The values to invoke a method with, one per parameter, each read as declared. */
    static Object[] forMethod(Method method, Bundle args) {
        Type[] parameterTypes = method.getGenericParameterTypes();
        Object[] values = new Object[parameterTypes.length];
        for (int i = 0; i < parameterTypes.length; i++) {
            values[i] = toJavaValue(parameterTypes[i], sentArgument(args, i), "arg" + i);
        }
        return values;
    }

    /**
     * Reads one value as a Java type:
     *   numbers, booleans, chars and enums, from their text;
     *   arrays and collections, from a JSON array or comma-separated values;
     *   maps, from a JSON object, its keys and values each read as declared;
     *   types written as text - UUID, URI, File, Date, Locale, java.time, Uri, or a class of
     *   the app's own with a parse() - the way the type itself builds one from text;
     *   Bundles and the app's own classes, from a JSON object keyed by field name.
     * Values already of the type - Parcelables, Bundles - pass as they are.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static Object toJavaValue(Type type, Object value, String path) {
        Class<?> targetClass = rawClassOf(type);
        if (targetClass.getName().equals("java.util.Optional")) {
            // Named, not referenced: Optional is API 24 and this library supports 21.
            Object inner = toJavaValue(typeArgument(type, 0), value, path);
            try {
                return targetClass.getMethod("ofNullable", Object.class).invoke(null, inner);
            } catch (ReflectiveOperationException e) {
                throw badArgument(path, "an Optional");
            }
        }
        if (value != null && (targetClass == String.class || targetClass == CharSequence.class)) {
            // Taken as sent: "null" stays the text it always was for a string.
            return String.valueOf(value);
        }
        Object parsed = jsonValueOf(value);
        if (parsed == null || parsed == JSONObject.NULL) {
            requireArgument(!targetClass.isPrimitive(), path, "a value");
            return null;
        }
        if (targetClass.isInstance(parsed) || isBoxedForm(targetClass, parsed.getClass())) {
            return parsed;
        }
        String text = String.valueOf(parsed).trim();

        if (targetClass == boolean.class || targetClass == Boolean.class) {
            return booleanFromText(text, path);
        }
        if (targetClass == char.class || targetClass == Character.class) {
            requireArgument(text.length() == 1, path, "a character");
            return text.charAt(0);
        }
        if (targetClass.isPrimitive() || Number.class.isAssignableFrom(targetClass)) {
            return numberFromText(targetClass, text, path);
        }
        if (targetClass.isEnum()) {
            try {
                return Enum.valueOf((Class<Enum>) targetClass, text);
            } catch (IllegalArgumentException e) {
                throw badArgument(path, "one of " + Arrays.toString(targetClass.getEnumConstants()));
            }
        }
        if (targetClass == char[].class && !(parsed instanceof JSONArray)) {
            return text.toCharArray();
        }
        if (targetClass.isArray()) {
            Type elementType = componentTypeOf(type);
            JSONArray items = listOf(parsed, path);
            Object array = Array.newInstance(targetClass.getComponentType(), items.length());
            for (int i = 0; i < items.length(); i++) {
                Array.set(array, i, toJavaValue(elementType, items.opt(i), path + "[" + i + "]"));
            }
            return array;
        }
        if (Collection.class.isAssignableFrom(targetClass) || targetClass == Iterable.class) {
            JSONArray items = listOf(parsed, path);
            Collection<Object> collection = (Collection<Object>) newContainer(targetClass, path);
            for (int i = 0; i < items.length(); i++) {
                collection.add(toJavaValue(typeArgument(type, 0), items.opt(i), path + "[" + i + "]"));
            }
            return collection;
        }
        if (Map.class.isAssignableFrom(targetClass)) {
            JSONObject object = jsonObjectOf(parsed, path);
            Map<Object, Object> map = (Map<Object, Object>) newContainer(targetClass, path);
            for (Iterator<String> keys = object.keys(); keys.hasNext(); ) {
                String key = keys.next();
                map.put(toJavaValue(typeArgument(type, 0), key, path + " key " + key),
                        toJavaValue(typeArgument(type, 1), object.opt(key), path + "." + key));
            }
            return map;
        }
        if (targetClass == Bundle.class) {
            return bundleOf(jsonObjectOf(parsed, path));
        }
        if (targetClass == JSONObject.class || targetClass == JSONArray.class) {
            throw badArgument(path, "a " + targetClass.getSimpleName());
        }
        if (!(parsed instanceof JSONObject)) {
            Object built = fromText(targetClass, text, path);
            if (built != null) {
                return built;
            }
        }
        return objectOfType(type, jsonObjectOf(parsed, path), path);
    }

    // ---- Declared functions -----------------------------------------------------------------

    /** The declared names of the common types, and the Java types that read them. */
    private static final Map<String, Class<?>> DECLARED_TYPES = new LinkedHashMap<>();

    static {
        DECLARED_TYPES.put("", String.class);
        DECLARED_TYPES.put("string", String.class);
        DECLARED_TYPES.put("boolean", Boolean.class);
        DECLARED_TYPES.put("int", Integer.class);
        DECLARED_TYPES.put("integer", Integer.class);
        DECLARED_TYPES.put("long", Long.class);
        DECLARED_TYPES.put("short", Short.class);
        DECLARED_TYPES.put("byte", Byte.class);
        DECLARED_TYPES.put("float", Float.class);
        DECLARED_TYPES.put("double", Double.class);
        DECLARED_TYPES.put("number", Double.class);
        DECLARED_TYPES.put("jsonobject", JSONObject.class);
        DECLARED_TYPES.put("object", JSONObject.class);
        DECLARED_TYPES.put("jsonarray", JSONArray.class);
        DECLARED_TYPES.put("array", JSONArray.class);
    }

    /**
     * The arguments of a declared function, as the JSON object a FunctionRunner is handed:
     * keyed by the contract's own argument names, in its declared order. An empty argument
     * is left out entirely, so the runner sees a missing key rather than "".
     */
    static String forDeclaredFunction(JSONArray declaredArguments, Bundle args) throws JSONException {
        JSONObject named = new JSONObject();
        for (int i = 0; declaredArguments != null && i < declaredArguments.length(); i++) {
            JSONObject declaration = declaredArguments.getJSONObject(i);
            Object sent = sentArgument(args, i);
            String text = (sent == null) ? "" : String.valueOf(sent).trim();
            if (text.isEmpty()) {
                continue;
            }
            String name = declaration.getString("name");
            named.put(name, toDeclaredValue(declaration, declaration.optString("type", "String"), text, name));
        }
        return named.toString();
    }

    /**
     * The declared-contract counterpart of toJavaValue(): the same checks, but the answer
     * stays JSON, since that is what a runner is handed.
     *
     * A declaration may narrow its type further, which is how a JavaScript app describes a type
     * of its own - the SDK cannot see one otherwise:
     *   "fields": [{"name":"top","type":"String"}, ...]  the value is an object of these fields
     *   "values": ["top","shoes"]                         the value is one of these
     * A type the SDK does not know and that declares neither is passed on as it arrived.
     */
    static Object toDeclaredValue(JSONObject declaration, String type, Object value, String path)
            throws JSONException {
        if (value == null || value == JSONObject.NULL) {
            return JSONObject.NULL;
        }
        String typeName = type.trim();
        if (typeName.endsWith("[]")) {
            String elementType = typeName.substring(0, typeName.length() - 2);
            JSONArray items = listOf(value, path);
            JSONArray converted = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                converted.put(toDeclaredValue(declaration, elementType, items.opt(i), path + "[" + i + "]"));
            }
            return converted;
        }

        Class<?> commonType = DECLARED_TYPES.get(typeName.toLowerCase(Locale.US));
        Object converted = commonType != null ? toJavaValue(commonType, value, path) : jsonValueOf(value);
        if (converted == null || converted == JSONObject.NULL) {
            return JSONObject.NULL;
        }

        JSONArray allowedValues = declaration.optJSONArray("values");
        if (allowedValues != null) {
            requireArgument(containsText(allowedValues, converted), path, "one of " + allowedValues);
        }
        JSONArray fields = declaration.optJSONArray("fields");
        return fields == null ? converted : objectOfDeclaredFields(fields, converted, path);
    }

    /** The declared-contract counterpart of objectOfType(): each field checked as declared. */
    private static JSONObject objectOfDeclaredFields(JSONArray fields, Object value, String path)
            throws JSONException {
        JSONObject sent = jsonObjectOf(value, path);
        JSONObject checked = new JSONObject();
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.getJSONObject(i);
            String name = field.getString("name");
            if (sent.has(name)) {
                checked.put(name, toDeclaredValue(field, field.optString("type", "String"),
                        sent.get(name), path + "." + name));
            }
        }
        for (Iterator<String> keys = sent.keys(); keys.hasNext(); ) {
            String key = keys.next();
            requireArgument(checked.has(key), path, "no field named " + key);
        }
        return checked;
    }

    private static boolean containsText(JSONArray values, Object value) {
        for (int i = 0; i < values.length(); i++) {
            if (String.valueOf(values.opt(i)).equals(String.valueOf(value))) {
                return true;
            }
        }
        return false;
    }

    // ---- Classes of the app's own -----------------------------------------------------------

    /**
     * A class of the app's own, filled field by field from a JSON object keyed by field name,
     * superclass fields included. Fields left out keep their defaults; a key naming no field
     * is refused, not ignored. A generic class is read with its type arguments: Box<Move>'s
     * "T item" is a Move.
     */
    private static Object objectOfType(Type type, JSONObject json, String path) {
        Class<?> declaredClass = rawClassOf(type);
        Class<?> targetClass = concreteClassOf(declaredClass, json, path);
        Object instance = newInstanceOf(targetClass, path);
        Set<String> filled = new LinkedHashSet<>();
        Type owner = (targetClass == declaredClass) ? type : targetClass;
        for (Class<?> cls = targetClass; cls != null && cls != Object.class;
                owner = resolved(cls.getGenericSuperclass(), owner), cls = cls.getSuperclass()) {
            for (Field field : cls.getDeclaredFields()) {
                String name = field.getName();
                if (!isDataField(field) || !json.has(name) || !filled.add(name)) {
                    continue;
                }
                try {
                    field.setAccessible(true);
                    field.set(instance, toJavaValue(resolved(field.getGenericType(), owner),
                            json.opt(name), path + "." + name));
                } catch (IllegalAccessException e) {
                    throw badArgument(path + "." + name, "a field that can be set");
                }
            }
        }
        for (Iterator<String> keys = json.keys(); keys.hasNext(); ) {
            String key = keys.next();
            requireArgument(filled.contains(key) || key.equals(SUBTYPE_KEY), path,
                    "no field named " + key + " in " + targetClass.getSimpleName());
        }
        return instance;
    }

    /**
     * The class to create: the declared one, unless "@type" names a subclass -
     * {"@type":"Circle","radius":2}. An interface or abstract class without one is created as
     * the one known subtype that has every field sent, so {"radius":2} is a Circle as long as
     * no other kind of Shape has a radius. The name may be a known subtype's, or a class's in
     * full, nested in the declared type, or beside it. Only a subtype of the declared type is
     * ever created, and none is initialised by looking.
     */
    private static Class<?> concreteClassOf(Class<?> declaredClass, JSONObject json, String path) {
        String named = json.optString(SUBTYPE_KEY, "");
        List<Class<?>> subtypes = knownSubtypesOf(declaredClass);
        if (named.isEmpty()) {
            if (isCreatable(declaredClass) || subtypes.isEmpty()) {
                return declaredClass;
            }
            return subtypeWithFields(subtypes, json, path);
        }

        for (Class<?> subtype : subtypes) {
            if (subtype.getSimpleName().equals(named) || subtype.getName().equals(named)) {
                return subtype;
            }
        }
        String declaredName = declaredClass.getName();
        String sibling = declaredName.substring(0,
                Math.max(declaredName.lastIndexOf('.'), declaredName.lastIndexOf('$')) + 1);
        ClassLoader loader = declaredClass.getClassLoader() != null
                ? declaredClass.getClassLoader() : ProviderService.class.getClassLoader();
        for (String candidate : new String[] {named, declaredName + "$" + named, sibling + named}) {
            try {
                Class<?> cls = Class.forName(candidate, false, loader);
                if (declaredClass.isAssignableFrom(cls)) {
                    return cls;
                }
            } catch (ClassNotFoundException ignored) {
                // Try the next place it could be.
            }
        }
        throw badArgument(path, "a " + SUBTYPE_KEY + " naming a kind of " + declaredClass.getSimpleName()
                + (subtypes.isEmpty() ? "" : ", one of " + describeSubtypes(subtypes)) + " (got " + named + ")");
    }

    /** The one subtype that has a field for every key sent; refused if none or several do. */
    private static Class<?> subtypeWithFields(List<Class<?>> subtypes, JSONObject json, String path) {
        Set<String> sentKeys = new LinkedHashSet<>();
        for (Iterator<String> keys = json.keys(); keys.hasNext(); ) {
            sentKeys.add(keys.next());
        }
        Class<?> match = null;
        for (Class<?> subtype : subtypes) {
            if (dataFieldsOf(subtype).keySet().containsAll(sentKeys)) {
                requireArgument(match == null, path, SUBTYPE_KEY + " to choose between " + describeSubtypes(subtypes));
                match = subtype;
            }
        }
        requireArgument(match != null, path, "one of " + describeSubtypes(subtypes));
        return match;
    }

    /**
     * Through its no-argument constructor when it has one. A class that takes its fields as
     * constructor arguments instead - a Kotlin data class, say - is allocated without running
     * one, as Gson does, and its fields then come from the JSON.
     */
    private static Object newInstanceOf(Class<?> cls, String path) {
        if (!isCreatable(cls)) {
            throw badArgument(path, "a " + SUBTYPE_KEY + " naming which " + cls.getSimpleName() + " to create");
        }
        try {
            Constructor<?> constructor = cls.getDeclaredConstructor();
            constructor.setAccessible(true);
            return constructor.newInstance();
        } catch (NoSuchMethodException e) {
            return allocateWithoutConstructor(cls, path);
        } catch (ReflectiveOperationException e) {
            throw badArgument(path, "a " + cls.getSimpleName() + ", which could not be created");
        }
    }

    private static Object allocateWithoutConstructor(Class<?> cls, String path) {
        try {
            Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
            Field theUnsafe = unsafeClass.getDeclaredField("theUnsafe");
            theUnsafe.setAccessible(true);
            return unsafeClass.getMethod("allocateInstance", Class.class).invoke(theUnsafe.get(null), cls);
        } catch (ReflectiveOperationException e) {
            throw badArgument(path, "a " + cls.getSimpleName() + ", which could not be created");
        }
    }

    // ---- Types built from text --------------------------------------------------------------

    /** Factories that build a value from its text, tried in this order. */
    private static final String[] TEXT_FACTORIES =
            {"fromString", "parse", "forLanguageTag", "valueOf", "of", "compile"};

    /**
     * A type written as text, built the way the type itself builds one: a long or int
     * constructor for whole-number text (Date from epoch millis, AtomicLong, AtomicInteger), a
     * static factory above returning the type (UUID, Uri, Locale, LocalDate, Pattern), or a
     * String constructor (URI, URL, File, a class of the app's own). Null when the type offers
     * none of these.
     */
    private static Object fromText(Class<?> targetClass, String text, String path) {
        try {
            if (text.matches("-?\\d+")) {
                Object built = fromWholeNumber(targetClass, text);
                if (built != null) {
                    return built;
                }
            }
            for (String factoryName : TEXT_FACTORIES) {
                for (Class<?> parameterType : new Class<?>[] {String.class, CharSequence.class}) {
                    try {
                        Method factory = targetClass.getMethod(factoryName, parameterType);
                        if (Modifier.isStatic(factory.getModifiers())
                                && targetClass.isAssignableFrom(factory.getReturnType())) {
                            return factory.invoke(null, text);
                        }
                    } catch (NoSuchMethodException ignored) {
                        // Not this one.
                    }
                }
            }
            return targetClass.getConstructor(String.class).newInstance(text);
        } catch (InvocationTargetException e) {
            throw badArgument(path, "a valid " + targetClass.getSimpleName() + " (" + e.getCause() + ")");
        } catch (ReflectiveOperationException e) {
            return null;
        }
    }

    /** Through a long or int constructor, or null if the type has neither. */
    private static Object fromWholeNumber(Class<?> targetClass, String text) throws ReflectiveOperationException {
        try {
            return targetClass.getConstructor(long.class).newInstance(Long.parseLong(text));
        } catch (NoSuchMethodException ignored) {
            // Try an int constructor instead.
        }
        try {
            return targetClass.getConstructor(int.class).newInstance(Integer.parseInt(text));
        } catch (NoSuchMethodException ignored) {
            return null;
        }
    }

    private static Object numberFromText(Class<?> numberClass, String text, String path) {
        requireArgument(!text.isEmpty(), path, "a number");
        try {
            if (numberClass == int.class || numberClass == Integer.class) {
                return Integer.parseInt(text);
            }
            if (numberClass == long.class || numberClass == Long.class) {
                return Long.parseLong(text);
            }
            if (numberClass == double.class || numberClass == Double.class || numberClass == Number.class) {
                return Double.parseDouble(text);
            }
            if (numberClass == float.class || numberClass == Float.class) {
                return Float.parseFloat(text);
            }
            if (numberClass == short.class || numberClass == Short.class) {
                return Short.parseShort(text);
            }
            if (numberClass == byte.class || numberClass == Byte.class) {
                return Byte.parseByte(text);
            }
            if (numberClass == BigInteger.class) {
                return new BigInteger(text);
            }
            if (numberClass == BigDecimal.class) {
                return new BigDecimal(text);
            }
        } catch (NumberFormatException e) {
            throw badArgument(path, "a valid " + numberClass.getSimpleName());
        }
        // Any other Number - AtomicLong, a class of the app's own - builds itself from text.
        Object built = fromText(numberClass, text, path);
        requireArgument(built != null, path, "a supported number type");
        return built;
    }

    private static boolean booleanFromText(String text, String path) {
        String lower = text.toLowerCase(Locale.US);
        if (lower.equals("true") || lower.equals("1") || lower.equals("yes") || lower.equals("on")) {
            return true;
        }
        if (lower.equals("false") || lower.equals("0") || lower.equals("no") || lower.equals("off")) {
            return false;
        }
        throw badArgument(path, "true or false");
    }

    // ---- Containers -------------------------------------------------------------------------

    /**
     * The collection or map to fill: the declared class itself when it can be created, or the
     * usual implementation of the interface it names.
     */
    private static Object newContainer(Class<?> containerClass, String path) {
        Object container;
        if (isCreatable(containerClass)) {
            container = newInstanceOf(containerClass, path);
        } else if (ConcurrentMap.class.isAssignableFrom(containerClass)) {
            container = new ConcurrentHashMap<>();
        } else if (SortedMap.class.isAssignableFrom(containerClass)) {
            container = new TreeMap<>();
        } else if (Map.class.isAssignableFrom(containerClass)) {
            container = new LinkedHashMap<>();
        } else if (SortedSet.class.isAssignableFrom(containerClass)) {
            container = new TreeSet<>();
        } else if (Set.class.isAssignableFrom(containerClass)) {
            container = new LinkedHashSet<>();
        } else if (Queue.class.isAssignableFrom(containerClass)) {
            container = new ArrayDeque<>();
        } else {
            container = new ArrayList<>();
        }
        requireArgument(containerClass.isInstance(container), path,
                "a type it can create (got " + containerClass.getSimpleName() + ")");
        return container;
    }

    /** A Bundle from a JSON object: nested objects become Bundles, lists become lists of their items' text. */
    private static Bundle bundleOf(JSONObject json) {
        Bundle bundle = new Bundle();
        for (Iterator<String> keys = json.keys(); keys.hasNext(); ) {
            String key = keys.next();
            Object value = json.opt(key);
            if (value instanceof Boolean) {
                bundle.putBoolean(key, (Boolean) value);
            } else if (value instanceof Integer) {
                bundle.putInt(key, (Integer) value);
            } else if (value instanceof Long) {
                bundle.putLong(key, (Long) value);
            } else if (value instanceof Number) {
                bundle.putDouble(key, ((Number) value).doubleValue());
            } else if (value instanceof JSONObject) {
                bundle.putBundle(key, bundleOf((JSONObject) value));
            } else if (value instanceof JSONArray) {
                JSONArray items = (JSONArray) value;
                ArrayList<String> texts = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                    texts.add(String.valueOf(items.opt(i)));
                }
                bundle.putStringArrayList(key, texts);
            } else {
                bundle.putString(key, value == JSONObject.NULL ? null : String.valueOf(value));
            }
        }
        return bundle;
    }

    // ---- JSON text --------------------------------------------------------------------------

    @SuppressWarnings("deprecation")
    private static Object sentArgument(Bundle args, int index) {
        return (args == null) ? null : args.get("arg" + index);
    }

    /**
     * Text holding a JSON object or array, read as one, and "null" as null. Anything else is
     * left as it is, for the declared type to read - a number or boolean parses more strictly
     * than JSON would.
     */
    private static Object jsonValueOf(Object value) {
        if (!(value instanceof String)) {
            return value;
        }
        String trimmed = ((String) value).trim();
        if (trimmed.equals("null")) {
            return JSONObject.NULL;
        }
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            return value;
        }
        try {
            JSONTokener tokener = new JSONTokener(trimmed);
            Object parsed = tokener.nextValue();
            return tokener.nextClean() == 0 ? parsed : value;
        } catch (JSONException e) {
            return value;
        }
    }

    /** A JSON array, or - text typed by hand - comma-separated values. */
    private static JSONArray listOf(Object value, String path) {
        Object parsed = jsonValueOf(value);
        if (parsed instanceof JSONArray) {
            return (JSONArray) parsed;
        }
        requireArgument(!(parsed instanceof JSONObject), path, "a list");
        String text = String.valueOf(parsed).trim();
        return new JSONArray(text.isEmpty() ? new ArrayList<String>() : Arrays.asList(text.split("\\s*,\\s*")));
    }

    private static JSONObject jsonObjectOf(Object value, String path) {
        if (value instanceof JSONObject) {
            return (JSONObject) value;
        }
        throw badArgument(path, "a JSON object");
    }

    // ---- Errors -----------------------------------------------------------------------------

    private static void requireArgument(boolean condition, String path, String expected) {
        if (!condition) {
            throw badArgument(path, expected);
        }
    }

    private static IllegalArgumentException badArgument(String path, String expected) {
        return new IllegalArgumentException(path + " expects " + expected);
    }
}
