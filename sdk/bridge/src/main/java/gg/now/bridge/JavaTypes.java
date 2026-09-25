package gg.now.bridge;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Reflection helpers for declared Java types: generics, arrays, data fields and subtypes. */
final class JavaTypes {

    /** Names the subclass to create in place of an argument's declared type. */
    static final String SUBTYPE_KEY = "@type";

    private JavaTypes() {
    }

    static Class<?> rawClassOf(Type type) {
        if (type instanceof Class) {
            return (Class<?>) type;
        }
        if (type instanceof ParameterizedType) {
            return (Class<?>) ((ParameterizedType) type).getRawType();
        }
        if (type instanceof GenericArrayType) {
            Type component = ((GenericArrayType) type).getGenericComponentType();
            return Array.newInstance(rawClassOf(component), 0).getClass();
        }
        if (type instanceof WildcardType) {
            // Kotlin's List<Foo> reaches Java as List<? extends Foo>.
            return rawClassOf(((WildcardType) type).getUpperBounds()[0]);
        }
        if (type instanceof TypeVariable) {
            // A T nothing filled in: read as its bound, Object unless it declares one.
            return rawClassOf(((TypeVariable<?>) type).getBounds()[0]);
        }
        return Object.class;
    }

    static Type componentTypeOf(Type arrayType) {
        return arrayType instanceof GenericArrayType
                ? ((GenericArrayType) arrayType).getGenericComponentType()
                : rawClassOf(arrayType).getComponentType();
    }

    /** One of a generic type's arguments - List<T>'s T, Map<K, V>'s V - or Object if unstated. */
    static Type typeArgument(Type type, int index) {
        if (type instanceof ParameterizedType) {
            Type[] arguments = ((ParameterizedType) type).getActualTypeArguments();
            if (index < arguments.length) {
                return arguments[index];
            }
        }
        return Object.class;
    }

    /**
     * A type with its owner's type arguments filled in, so Box<Move>'s "T item" and
     * "List<T> items" are read as Moves. Whatever it cannot fill in is left as declared.
     */
    static Type resolved(Type type, Type owner) {
        if (type instanceof TypeVariable && owner instanceof ParameterizedType) {
            TypeVariable<?>[] variables = rawClassOf(owner).getTypeParameters();
            Type[] arguments = ((ParameterizedType) owner).getActualTypeArguments();
            for (int i = 0; i < variables.length && i < arguments.length; i++) {
                if (variables[i].equals(type)) {
                    return arguments[i];
                }
            }
        }
        if (type instanceof ParameterizedType) {
            final ParameterizedType declared = (ParameterizedType) type;
            final Type[] arguments = declared.getActualTypeArguments().clone();
            for (int i = 0; i < arguments.length; i++) {
                arguments[i] = resolved(arguments[i], owner);
            }
            return new ParameterizedType() {
                @Override
                public Type[] getActualTypeArguments() {
                    return arguments.clone();
                }

                @Override
                public Type getRawType() {
                    return declared.getRawType();
                }

                @Override
                public Type getOwnerType() {
                    return declared.getOwnerType();
                }
            };
        }
        return type;
    }

    /** How a type is named in the contract: String, int[], List<Move>. */
    static String nameOf(Type type) {
        if (type instanceof Class) {
            Class<?> cls = (Class<?>) type;
            return cls.isArray() ? nameOf(cls.getComponentType()) + "[]" : cls.getSimpleName();
        }
        if (type instanceof ParameterizedType) {
            ParameterizedType parameterized = (ParameterizedType) type;
            StringBuilder name = new StringBuilder(nameOf(parameterized.getRawType())).append('<');
            Type[] arguments = parameterized.getActualTypeArguments();
            for (int i = 0; i < arguments.length; i++) {
                if (i > 0) {
                    name.append(", ");
                }
                name.append(nameOf(arguments[i]));
            }
            return name.append('>').toString();
        }
        return type.toString();
    }

    static boolean isCreatable(Class<?> cls) {
        return !cls.isInterface() && !Modifier.isAbstract(cls.getModifiers());
    }

    /** A field a value is read into: not static, transient or compiler-made. */
    static boolean isDataField(Field field) {
        int modifiers = field.getModifiers();
        return !Modifier.isStatic(modifiers) && !Modifier.isTransient(modifiers) && !field.isSynthetic();
    }

    /** Each data field of a class, its own before its superclasses', with its type's name. */
    static Map<String, String> dataFieldsOf(Class<?> type) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (Class<?> cls = type; cls != null && cls != Object.class; cls = cls.getSuperclass()) {
            for (Field field : cls.getDeclaredFields()) {
                if (isDataField(field) && !fields.containsKey(field.getName())) {
                    fields.put(field.getName(), nameOf(field.getGenericType()));
                }
            }
        }
        return fields;
    }

    /** The classes a value of this type may be created as: its @Subtypes, and those nested in it. */
    static List<Class<?>> knownSubtypesOf(Class<?> type) {
        Set<Class<?>> candidates = new LinkedHashSet<>();
        ProviderService.Subtypes listed = type.getAnnotation(ProviderService.Subtypes.class);
        if (listed != null) {
            candidates.addAll(Arrays.asList(listed.value()));
        }
        candidates.addAll(Arrays.asList(type.getDeclaredClasses()));
        List<Class<?>> subtypes = new ArrayList<>();
        for (Class<?> candidate : candidates) {
            if (candidate != type && type.isAssignableFrom(candidate) && isCreatable(candidate)) {
                subtypes.add(candidate);
            }
        }
        return subtypes;
    }

    /** Circle{radius=double, color=String}, ... - what an error shows a caller it could send. */
    static String describeSubtypes(List<Class<?>> subtypes) {
        List<String> described = new ArrayList<>();
        for (Class<?> subtype : subtypes) {
            described.add(subtype.getSimpleName() + dataFieldsOf(subtype));
        }
        return described.toString();
    }

    /** Whether a value of class boxed may stand for the primitive type primitive. */
    static boolean isBoxedForm(Class<?> primitive, Class<?> boxed) {
        return (primitive == int.class && boxed == Integer.class)
                || (primitive == long.class && boxed == Long.class)
                || (primitive == double.class && boxed == Double.class)
                || (primitive == float.class && boxed == Float.class)
                || (primitive == short.class && boxed == Short.class)
                || (primitive == byte.class && boxed == Byte.class)
                || (primitive == char.class && boxed == Character.class)
                || (primitive == boolean.class && boxed == Boolean.class);
    }
}
