const { MongoClient } = require('mongodb');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const FormData = require('form-data');

const uri = 'mongodb+srv://hakanatayilmaz243:hakanata123@tryon.7vvdbo9.mongodb.net/?retryWrites=true&w=majority&appName=tryon';
const dbName = 'test';
const collectionName = '3dmodels';

// Konfigürasyon
const config = {
  blenderPath: 'C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe',
  templateModelsDir: path.join(__dirname, 'template_models'),
  outputDir: path.join(__dirname, 'output_models'),
  texturesDir: path.join(__dirname, 'downloaded_textures'),
  apiBaseUrl: 'http://0.0.0.0:5000/api', // API base URL'inizi buraya yazın
  alperAuthToken: 'ALPER_AUTH_TOKEN_HERE' // Alper'in auth token'ını buraya ekleyin
};

// Template model seçimi
function getTemplateModel(category) {
  const templateMap = {
    'hoodie': 'HOODIE.glb',
    'tshirt': 'TSHIRT.glb',
    'pants': 'PANTS.glb',
    'jacket': 'JACKET.glb',
    'dress': 'DRESS.glb',
    'skirt': 'SKIRT.glb',
    'shorts': 'SHORTS.glb',
    'sweater': 'SWEATER.glb'
  };
  
  const templateFile = templateMap[category.toLowerCase()];
  if (!templateFile) {
    throw new Error(`Desteklenmeyen kategori: ${category}`);
  }
  
  const templatePath = path.join(config.templateModelsDir, templateFile);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template model bulunamadı: ${templatePath}`);
  }
  
  return templatePath;
}

// Gerekli klasörleri oluştur
function ensureDirectories() {
  [config.outputDir, config.texturesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Klasör oluşturuldu: ${dir}`);
    }
  });
  
  // Template models klasörünü kontrol et
  if (!fs.existsSync(config.templateModelsDir)) {
    console.error(`HATA: Template models klasörü bulunamadı: ${config.templateModelsDir}`);
    console.log('Lütfen template_models/ klasörünü oluşturun ve model dosyalarını ekleyin');
  }
}

async function downloadTexture(textureUrl, filepath) {
  const response = await axios({
    method: 'GET',
    url: textureUrl,
    responseType: 'stream',
  });

  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const writer = fs.createWriteStream(filepath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log(`Texture indirildi: ${textureUrl} → ${filepath}`);
      resolve(filepath);
    });
    writer.on('error', reject);
  });
}

function createDynamicPythonScript(modelPath, texturePath, outputPath) {
  const scriptTemplate = `
import bpy
import os
import sys
from mathutils import Vector

# Blender sahnesini temizle
bpy.ops.wm.read_factory_settings(use_empty=True)

# Dosya yolları
model_path = r"${modelPath.replace(/\\/g, '\\\\')}"
texture_path = r"${texturePath.replace(/\\/g, '\\\\')}"
output_path = r"${outputPath.replace(/\\/g, '\\\\')}"

print(f"Model yolu: {model_path}")
print(f"Texture yolu: {texture_path}")
print(f"Çıktı yolu: {output_path}")

# Kontrol et: Dosyalar mevcut mu?
if not os.path.exists(model_path):
    print(f"HATA: Model dosyası bulunamadı: {model_path}")
    sys.exit(1)
    
if not os.path.exists(texture_path):
    print(f"HATA: Texture dosyası bulunamadı: {texture_path}")
    sys.exit(1)

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

# Model işleme
for obj in mesh_objects:
    print(f"İşleniyor: {obj.name}")
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    # UV mapping iyileştirme
    try:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        
        bpy.ops.uv.unwrap(
            method='ANGLE_BASED',
            margin=0.001,
            correct_aspect=True
        )
        print(f"{obj.name} için gelişmiş UV unwrap tamamlandı")
        
        try:
            bpy.ops.uv.pack_islands(
                margin=0.001,
                rotate=True,
            )
            bpy.ops.uv.average_islands_scale()
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
    
    while obj.data.materials:
        obj.data.materials.pop(index=0)
    
    node_tree = material.node_tree
    nodes = node_tree.nodes
    
    for node in nodes:
        nodes.remove(node)
    
    output = nodes.new(type='ShaderNodeOutputMaterial')
    principled = nodes.new(type='ShaderNodeBsdfPrincipled')
    tex_coord = nodes.new(type='ShaderNodeTexCoord')
    tex_image = nodes.new(type='ShaderNodeTexImage')
    mapping = nodes.new(type='ShaderNodeMapping')
    
    output.location = (300, 0)
    principled.location = (100, 0)
    mapping.location = (-300, 0)
    tex_coord.location = (-500, 0)
    tex_image.location = (-100, 0)
    
    links = node_tree.links
    links.new(principled.outputs[0], output.inputs[0])
    links.new(tex_coord.outputs['UV'], mapping.inputs[0])
    links.new(mapping.outputs[0], tex_image.inputs[0])
    links.new(tex_image.outputs['Color'], principled.inputs[0])
    
    try:
        mapping.inputs[1].default_value[0] = -0.3
        mapping.inputs[1].default_value[1] = 0.0
        mapping.inputs[3].default_value[0] = 1.0
        mapping.inputs[3].default_value[1] = 1.0
        mapping.inputs[2].default_value[2] = 0.0
    except Exception as e:
        print(f"Mapping node ayarları yapılamadı: {e}")
    
    principled.inputs[7].default_value = 0.7
    
    try:
        img = bpy.data.images.load(texture_path)
        img.alpha_mode = 'CHANNEL_PACKED'
        tex_image.interpolation = 'Linear'
        tex_image.extension = 'REPEAT'
        tex_image.image = img
        print(f"Texture başarıyla yüklendi: {texture_path}")
    except Exception as e:
        print(f"Texture yükleme hatası: {e}")
        sys.exit(1)
    
    obj.data.materials.append(material)
    print(f"{obj.name} için materyal uygulandı")

# Render ayarları
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        for space in area.spaces:
            if space.type == 'VIEW_3D':
                space.shading.type = 'MATERIAL'

if bpy.context.scene.world is None:
    bpy.context.scene.world = bpy.data.worlds.new("NewWorld")
    
bpy.context.scene.world.use_nodes = True
bg = bpy.context.scene.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (1.0, 1.0, 1.0, 1)
bg.inputs[1].default_value = 0.4

bpy.ops.object.light_add(type='SUN', location=(5, 5, 5))
sun = bpy.context.active_object
sun.data.energy = 3
sun.rotation_euler = (0.785, 0, 0.785)

# Kamera ayarları
mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
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

center = (min_corner + max_corner) / 2
size = max_corner - min_corner
max_dim = max(size.x, size.y, size.z)

camera = bpy.context.scene.camera
if camera is None:
    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    bpy.context.scene.camera = camera

camera.location = center + Vector((0, -max_dim * 2.5, max_dim))
camera.data.clip_start = 0.1
camera.data.clip_end = max_dim * 10

direction = center - camera.location
rot_quat = direction.to_track_quat('-Z', 'Y')
camera.rotation_euler = rot_quat.to_euler()

# Modeli dışa aktar
try:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB'
    )
    print(f"Model başarıyla GLB formatında dışa aktarıldı: {output_path}")
    
    # Render al
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    render_path = output_path.replace('.glb', '_preview.png')
    bpy.context.scene.render.filepath = render_path
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print(f"Önizleme render'ı alındı: {render_path}")

except Exception as e:
    print(f"Dışa aktarma hatası: {e}")
    sys.exit(1)

print("Texture mapping işlemi tamamlandı!")
`;

  return scriptTemplate;
}

async function uploadToAPI(modelPath, previewPath, garmentId) {
  try {
    console.log(`API'ye yükleme başlıyor - Model: ${modelPath}, Preview: ${previewPath}, GarmentId: ${garmentId}`);
    
    // FormData oluştur
    const formData = new FormData();
    
    // Dosyaları FormData'ya ekle
    formData.append('model', fs.createReadStream(modelPath), {
      filename: path.basename(modelPath),
      contentType: 'model/gltf-binary'
    });
    
    formData.append('preview', fs.createReadStream(previewPath), {
      filename: path.basename(previewPath),
      contentType: 'image/png'
    });
    
    formData.append('garmentId', garmentId);
    
    // API'ye POST isteği gönder
    const response = await axios.post(`${config.apiBaseUrl}/3d-models`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${config.alperAuthToken}`
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    console.log('API Upload başarılı:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('API Upload hatası:', error.response?.data || error.message);
    throw error;
  }
}

async function processModel(documentData) {
  try {
    console.log('Model işleme başlıyor...', documentData);
    
    // Gerekli alanları kontrol et
    if (!documentData.category || !documentData.texture_path) {
      throw new Error('category ve texture_path alanları gerekli');
    }
    
    if (!documentData.garmentId) {
      throw new Error('garmentId alanı gerekli');
    }
    
    // Template modeli seç
    const templateModelPath = getTemplateModel(documentData.category);
    console.log(`Template model seçildi: ${templateModelPath}`);
    
    // Dosya adlarını belirle
    const timestamp = Date.now();
    const textureFileName = `texture_${timestamp}.png`;
    const outputFileName = `${documentData.category}_${timestamp}.glb`;
    
    const texturePath = path.join(config.texturesDir, textureFileName);
    const outputPath = path.join(config.outputDir, outputFileName);
    
    // Texture dosyasını indir
    await downloadTexture(documentData.texture_path, texturePath);
    
    // Dinamik Python script oluştur
    const scriptContent = createDynamicPythonScript(templateModelPath, texturePath, outputPath);
    const tempScriptPath = path.join(__dirname, `temp_script_${timestamp}.py`);
    fs.writeFileSync(tempScriptPath, scriptContent);
    
    // Blender ile Python scriptini çalıştır
    const result = await new Promise((resolve, reject) => {
      const blenderProcess = spawn(config.blenderPath, [
        '--background',
        '--python', tempScriptPath
      ]);
      
      let output = '';
      let errorOutput = '';
      
      blenderProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log('Blender Output:', text);
        output += text;
      });
      
      blenderProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.error('Blender Error:', text);
        errorOutput += text;
      });
      
      blenderProcess.on('close', (code) => {
        // Geçici dosyaları temizle
        try {
          fs.unlinkSync(tempScriptPath);
          fs.unlinkSync(texturePath);
        } catch (e) {
          console.log('Geçici dosya silinemedi:', e.message);
        }
        
        if (code === 0) {
          console.log(`Model işleme tamamlandı: ${outputPath}`);
          resolve({
            success: true,
            outputPath: outputPath,
            previewPath: outputPath.replace('.glb', '_preview.png')
          });
        } else {
          reject(new Error(`Blender process failed with code ${code}: ${errorOutput}`));
        }
      });
      
      blenderProcess.on('error', (error) => {
        reject(error);
      });
    });
    
    // İşlenmiş dosyaları API üzerinden S3'e yükle
    const apiResponse = await uploadToAPI(
      result.outputPath,
      result.previewPath,
      documentData.garmentId
    );
    
    // Lokal dosyaları temizle
    try {
      fs.unlinkSync(result.outputPath);
      fs.unlinkSync(result.previewPath);
    } catch (e) {
      console.log('Çıktı dosyaları silinemedi:', e.message);
    }
    
    return {
      success: true,
      apiResponse: apiResponse,
      category: documentData.category,
      garmentId: documentData.garmentId
    };
    
  } catch (error) {
    console.error('Model işleme hatası:', error);
    throw error;
  }
}

async function main() {
  // Gerekli klasörleri oluştur
  ensureDirectories();
  
  const client = new MongoClient(uri);
  await client.connect();
  console.log('MongoDB bağlantısı kuruldu');

  const collection = client.db(dbName).collection(collectionName);
  
  const changeStream = collection.watch([{ $match: { operationType: 'insert' } }]);

  console.log('Yeni dökümanlar için bekleniyor...');
  console.log('Beklenen format: { category: "hoodie", texture_path: "https://...", garmentId: "garment123" }');
  console.log(`API Base URL: ${config.apiBaseUrl}`);
  console.log(`Auth Token: ${config.alperAuthToken ? 'Ayarlanmış' : 'AYARLANMADI!'}`);
  
  changeStream.on('change', async (change) => {
    console.log('Yeni döküman eklendi:', change.fullDocument);
    
    try {
      const result = await processModel(change.fullDocument);
      console.log('İşleme sonucu:', result);
      
      // İşleme sonucunu orijinal dökümana ekle
      await collection.updateOne(
        { _id: change.fullDocument._id },
        { 
          $set: { 
            processed: true,
            api_response: result.apiResponse,
            processed_at: new Date()
          }
        }
      );
      
    } catch (error) {
      console.error('Model işleme hatası:', error);
      
      // Hata durumunu kaydet
      await collection.updateOne(
        { _id: change.fullDocument._id },
        { 
          $set: { 
            processed: false,
            error: error.message,
            processed_at: new Date()
          }
        }
      );
    }
  });
}

main().catch(console.error);