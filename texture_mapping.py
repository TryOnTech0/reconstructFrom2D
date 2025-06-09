import bpy
import os
import sys
from mathutils import Vector
# Blender sahnesini temizle
bpy.ops.wm.read_factory_settings(use_empty=True)

# Dosya yollarını belirtin

model_path = r"D:\blender_example\template_models\HOODIE.glb"
texture_path = r"D:\blender_example\garment_textures\texture_zz.jpg"
output_path = r"D:\blender_example\output_models\HOODIE_output.glb"  # GLB formatı

print(f"Model yolu: {model_path}")
print(f"Texture yolu: {texture_path}")
print(f"Çıktı yolu: {output_path}")

# Kontrol et: Dosyalar mevcut mu?
if not os.path.exists(model_path):
    print(f"HATA: Model dosyası bulunamadı: {model_path}")
    sys.exit(1)
    
if not os.path.exists(texture_path):
    print(f"Texture dosyası bulunamadı, tek renk texture oluşturulacak")

# Modeli içe aktar
try:
    bpy.ops.import_scene.gltf(filepath=model_path)
    print(f"Model başarıyla içe aktarıldı: {model_path}")
except Exception as e:
    print(f"Model içe aktarılırken hata oluştu: {e}")
    sys.exit(1)

# Mesh objelerini bul
mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not mesh_objects:
    print("Hata: Mesh objesi bulunamadı!")
    sys.exit(1)

# T-shirt modelini işle
for obj in mesh_objects:
    print(f"İşleniyor: {obj.name}")
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    # UV mapping iyileştirme
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        
        # Daha iyi unwrap için parametre ayarları
        bpy.ops.uv.unwrap(
            method='ANGLE_BASED',  # Açı bazlı unwrap daha iyidir
            margin=0.001,          # Daha az marj = daha fazla kullanılabilir UV alanı
            correct_aspect=True     # Aspect ratio'yu korur
        )
        print(f"{obj.name} için gelişmiş UV unwrap tamamlandı")
        
        # UV adalarını daha iyi düzenle
        try:
            # Adaları sıkı şekilde pakitle
            bpy.ops.uv.pack_islands(
                margin=0.001,         # Adalar arası küçük marj
                rotate=True,         # Daha iyi yerleşim için rotasyona izin ver
            )
            
            # Ada ölçeklerini ortala
            bpy.ops.uv.average_islands_scale()
            
            # Adaları düzelt
            bpy.ops.uv.align_rotation()
        except Exception as e:
            print(f"UV adalarını düzenleme hatası: {e}")
            
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as e:
        print(f"UV unwrap sırasında hata: {e}")
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except:
            pass
    
    # Materyal oluştur
    material = bpy.data.materials.new(name=f"TextureMaterial_{obj.name}")
    material.use_nodes = True
    
    # Tüm mevcut materyalleri kaldır
    while obj.data.materials:
        obj.data.materials.pop(index=0)
    
    # Materyal node tree'yi basit tut
    node_tree = material.node_tree
    nodes = node_tree.nodes
    
    # Mevcut nodeları temizle
    for node in nodes:
        nodes.remove(node)
    
    # Temel nodeları ekle
    output = nodes.new(type='ShaderNodeOutputMaterial')
    principled = nodes.new(type='ShaderNodeBsdfPrincipled')
    tex_coord = nodes.new(type='ShaderNodeTexCoord')
    tex_image = nodes.new(type='ShaderNodeTexImage')
    
    # T-shirt için texture koordinatlarını iyileştirmek için mapping node ekle
    mapping = nodes.new(type='ShaderNodeMapping')
    
    # Düğümleri düzenle
    output.location = (300, 0)
    principled.location = (100, 0)
    mapping.location = (-300, 0)
    tex_coord.location = (-500, 0)
    tex_image.location = (-100, 0)
    
    # Nodeları bağla
    links = node_tree.links
    links.new(principled.outputs[0], output.inputs[0])             # BSDF -> Surface
    links.new(tex_coord.outputs['UV'], mapping.inputs[0])          # UV -> Mapping
    links.new(mapping.outputs[0], tex_image.inputs[0])             # Mapping -> Vector
    links.new(tex_image.outputs['Color'], principled.inputs[0])    # Texture -> Base Color
    
    # Mapping ayarları - Texture'ı sola kaydır
    try:
        # ÖNEMLİ DEĞİŞİKLİK: Texture'ı sola kaydır (X ekseni)
        # Negatif değer texture'ı sola kaydırır, pozitif değer sağa
        mapping.inputs[1].default_value[0] = -0.3    # X Location: Sola kaydır
        mapping.inputs[1].default_value[1] = 0.0    # Y Location
        
        # Ölçekleme
        mapping.inputs[3].default_value[0] = 1.0    # X Scale
        mapping.inputs[3].default_value[1] = 1.0    # Y Scale
        
        # Hafif döndürme (gerekirse)
        mapping.inputs[2].default_value[2] = 0.0    # Z Rotation (radyan)
    except Exception as e:
        print(f"Mapping node ayarları yapılamadı: {e}")
    
    # Basit materyal parametreleri
    principled.inputs[7].default_value = 0.7  # Roughness
    
    # Texture yükle
    try:
        if os.path.exists(texture_path):
            # Tekstür ayarlarını iyileştir
            img = bpy.data.images.load(texture_path)
            img.alpha_mode = 'CHANNEL_PACKED'  # Alpha kanalını doğru işle
            
            # Tekstür filtreleme ayarları
            tex_image.interpolation = 'Linear'  # Daha pürüzsüz görünüm
            tex_image.extension = 'REPEAT'      # Tiling için iyi
            
            tex_image.image = img
            print(f"Texture başarıyla yüklendi ve ayarları iyileştirildi: {texture_path}")
        else:
            # Mavi renk texture oluştur
            temp_img = bpy.data.images.new("Blue_Texture", 1024, 1024)
            pixels = [0.2, 0.6, 0.8, 1.0] * (1024 * 1024)  # RGBA mavi
            temp_img.pixels = pixels[:]
            tex_image.image = temp_img
            print("Tek renk mavi texture oluşturuldu")
    except Exception as e:
        print(f"Texture oluşturma hatası: {e}")
    
    # Materyali modele uygula
    obj.data.materials.append(material)
    print(f"{obj.name} için iyileştirilmiş materyal ve texture uygulandı")

# Viewport shading'i Material Preview moduna ayarla
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        for space in area.spaces:
            if space.type == 'VIEW_3D':
                space.shading.type = 'MATERIAL'

if bpy.context.scene.world is None:
    bpy.context.scene.world = bpy.data.worlds.new("NewWorld")
    
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1)  # Beyaz ışık
bg.inputs[1].default_value = 0.4  # Ortam ışığı gücü

bpy.ops.object.light_add(type='SUN', location=(5, 5, 5))
sun = bpy.context.active_object
sun.data.energy = 3
sun.rotation_euler = (0.785, 0, 0.785)


mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']

# Hepsinin bounding box'larını birleştirerek genel bir sınır kutusu oluştur
min_corner = Vector((float('inf'), float('inf'), float('inf')))
max_corner = Vector((float('-inf'), float('-inf'), float('-inf')))

for obj in mesh_objects:
    for corner in obj.bound_box:
        world_corner = obj.matrix_world @ Vector(corner)
        min_corner = Vector((min(min_corner.x, world_corner.x),
                             min(min_corner.y, world_corner.y),
                             min(min_corner.z, world_corner.z)))
        max_corner = Vector((max(max_corner.x, world_corner.x),
                             max(max_corner.y, world_corner.y),
                             max(max_corner.z, world_corner.z)))

# Modelin ortasını bul
center = (min_corner + max_corner) / 2
size = max_corner - min_corner
max_dim = max(size.x, size.y, size.z)

# Kamera objesini al veya oluştur
camera = bpy.context.scene.camera
if camera is None:
    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    bpy.context.scene.camera = camera

# Kamerayı modelin önüne konumlandır (Z ekseni yukarı kabul, Y ekseni derinlik)
camera.location = center + Vector((0, -max_dim * 2.5, max_dim))  # Mesafeyi max_dim ile ayarla
camera.data.clip_start = 0.1
camera.data.clip_end = max_dim * 10

# Kameranın baktığı yeri modelin ortası yap
direction = center - camera.location
rot_quat = direction.to_track_quat('-Z', 'Y')
camera.rotation_euler = rot_quat.to_euler()

# Modeli dışa aktar
try:
    bpy.ops.object.select_all(action='SELECT')
    
    # GLB formatında dışa aktar
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB'
    )
    print(f"Model başarıyla GLB formatında dışa aktarıldı: {output_path}")
    
        # Kamera açısını ayarla (varsayılan kamera varsa onu kullan)
    camera = bpy.data.objects.get("Camera")
    if camera is None:
        # Kamera yoksa oluştur
        bpy.ops.object.camera_add(wlocation=(0, -3, 1.5), rotation=(1.2, 0, 0))
        camera = bpy.context.active_object

    # Sahnedeki kamera olarak ayarla
    bpy.context.scene.camera = camera

    # Render ayarları
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    bpy.context.scene.render.filepath = os.path.join("D:/blender_example/output_models", "kazak_pre.png")
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024

    # Render al
    bpy.ops.render.render(write_still=True)
    print("Önizleme render'ı alındı: preview.png")

except Exception as e:
    # GLB dışa aktarma başarısız olursa, Blender formatını kullan
    print(f"GLB dışa aktarma hatası: {e}")
    
    # Blender formatında kaydet (son çare)
    try:
        blend_path = os.path.splitext(output_path)[0] + ".blend"
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)
        print(f"Model Blender dosyası olarak kaydedildi: {blend_path}")
    except Exception as e3:
        print(f"Blender dosyası kaydetme hatası: {e3}")
        sys.exit(1)

print("İyileştirilmiş texture mapping işlemi tamamlandı!")